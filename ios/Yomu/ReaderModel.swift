import Foundation
import SwiftUI
import VisionKit

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
    @Published private(set) var analysis: ImageAnalysis?
    @Published private(set) var scanError: String?
    @Published private(set) var isScanning = true

    @Published private(set) var selection = ""
    @Published private(set) var explanation: Explanation = .none
    @Published private(set) var vocabulary: [VocabularyEntry] = []

    @AppStorage("yomu.level") var level: String = "N2"

    private let backend: Backend
    private let analyzer = PageAnalyzer()
    private var explainTask: Task<Void, Never>?
    private var vocabularyTask: Task<Void, Never>?
    private var cache: [String: String] = [:]

    init(image: UIImage, backend: Backend) {
        self.image = image
        self.backend = backend
    }

    var pageText: String { analysis?.transcript ?? "" }

    func scan() async {
        isScanning = true
        scanError = nil
        do {
            analysis = try await analyzer.analyze(image)
            if (analysis?.transcript ?? "").isEmpty {
                scanError = "No Japanese text found on this page."
            }
        } catch {
            scanError = error.localizedDescription
        }
        isScanning = false
    }

    /// Fired by Live Text as the reader drags. Debounced so an in-progress drag does
    /// not spend a request per character.
    func selectionChanged(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != selection else { return }
        selection = trimmed

        explainTask?.cancel()
        vocabularyTask?.cancel()

        guard !trimmed.isEmpty else {
            explanation = .none
            vocabulary = []
            return
        }

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
        } catch {
            guard !Task.isCancelled, selection == text else { return }
            explanation = .failed(error.localizedDescription)
        }
    }

    private func loadVocabulary(_ text: String) async {
        let entries = await JapaneseDictionary.shared.entries(in: text)
        guard !Task.isCancelled, selection == text else { return }
        vocabulary = entries
    }
}
