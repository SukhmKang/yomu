import Foundation
import SwiftUI

/// Owns one photographed page: its OCR analysis, the current selection, and the
/// lookups that follow from it. Selecting text is the only action — the explanation
/// and the vocabulary both arrive on their own.
@MainActor
final class ReaderModel: ObservableObject {
    enum Explanation: Equatable {
        case none
        case loading
        case streaming(String)
        case ready(String)
        case failed(String)

        var text: String? {
            switch self {
            case .streaming(let t), .ready(let t): return t
            default: return nil
            }
        }
    }

    @Published private(set) var image: UIImage
    @Published private(set) var page: ScannedPage?
    @Published private(set) var scanError: String?
    @Published private(set) var isScanning = true

    @Published private(set) var selected: Set<Int> = []
    @Published private(set) var selection = ""
    @Published private(set) var explanation: Explanation = .none
    @Published private(set) var vocabulary: [VocabularyEntry] = []

    @AppStorage("yomu.level") var level: String = "N2"

    private let backend: Backend
    private var explainTask: Task<Void, Never>?
    private var vocabularyTask: Task<Void, Never>?
    private var cache: [String: String] = [:]

    init(image: UIImage, backend: Backend) {
        self.image = image
        self.backend = backend
    }

    var regions: [TextRegion] { page?.regions ?? [] }
    var pageText: String { page?.fullText ?? "" }

    func scan() async {
        isScanning = true
        scanError = nil
        do {
            page = try await backend.scan(image: image)
            ScanArchive.log(scan: backend.lastScan, event: "scanned",
                            detail: ["regions": (page?.regions ?? []).map(\.text).joined(separator: " / ")])
        } catch {
            scanError = error.localizedDescription
            ScanArchive.log(scan: backend.lastScan, event: "scan-failed",
                            detail: ["error": error.localizedDescription])
        }
        isScanning = false
    }

    /// Regions are selected by tapping or sweeping the page. Debounced so a sweep
    /// does not spend a request per bubble it crosses.
    func select(_ indices: Set<Int>) {
        selected = indices
        let regions = self.regions
        let trimmed = indices.sorted()
            .compactMap { $0 < regions.count ? regions[$0].text : nil }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != selection else { return }
        selection = trimmed

        explainTask?.cancel()
        vocabularyTask?.cancel()

        guard !trimmed.isEmpty else {
            explanation = .none
            vocabulary = []
            return
        }

        ScanArchive.log(scan: backend.lastScan, event: "select",
                        detail: ["regions": indices.sorted().map(String.init).joined(separator: ","),
                                 "text": trimmed])

        explanation = .loading
        explainTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await self?.explain(trimmed)
        }
        vocabularyTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            await self?.loadVocabulary(trimmed)
        }
    }

    func clearSelection() { select([]) }

    func retryExplanation() {
        let text = selection
        guard !text.isEmpty else { return }
        cache[cacheKey(text)] = nil
        explanation = .loading
        explainTask?.cancel()
        explainTask = Task { [weak self] in await self?.explain(text) }
    }

    private func cacheKey(_ text: String) -> String { "\(level)\u{1}\(text)" }

    private func explain(_ text: String) async {
        if let cached = cache[cacheKey(text)] {
            explanation = .ready(cached)
            return
        }
        var accumulated = ""
        do {
            for try await delta in backend.explainStream(text: text, context: pageText, level: level) {
                guard !Task.isCancelled, selection == text else { return }
                accumulated += delta
                explanation = .streaming(accumulated)
            }
            guard !Task.isCancelled, selection == text else { return }
            guard !accumulated.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                explanation = .failed("The explanation came back empty. Please retry.")
                return
            }
            cache[cacheKey(text)] = accumulated
            explanation = .ready(accumulated)
            ScanArchive.log(scan: backend.lastScan, event: "explained",
                            detail: ["text": text, "level": level, "result": accumulated])
        } catch {
            guard !Task.isCancelled, selection == text else { return }
            explanation = .failed(error.localizedDescription)
            ScanArchive.log(scan: backend.lastScan, event: "explain-failed",
                            detail: ["text": text, "error": error.localizedDescription])
        }
    }

    private func loadVocabulary(_ text: String) async {
        let entries = await JapaneseDictionary.shared.entries(in: text)
        guard !Task.isCancelled, selection == text else { return }
        vocabulary = entries
    }
}
