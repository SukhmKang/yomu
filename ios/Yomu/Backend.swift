import Foundation

/// Talks to the Yomu API for explanations. OCR and dictionary lookups are on-device,
/// so this is the only network dependency in the app.
///
/// There is no sign-in. The app carries the API token in its bundle and sends it on
/// every request, so the endpoint stays closed to the internet without ever showing
/// the reader a lock screen.
@MainActor
final class Backend: ObservableObject {
    /// Override in Preferences; defaults to the deployed API.
    @Published var origin: String {
        didSet { UserDefaults.standard.set(origin, forKey: Self.originKey) }
    }

    private static let originKey = "yomu.origin"
    private static let defaultOrigin = "https://yomu-omega.vercel.app"

    /// Injected at build time from `Secrets.xcconfig`, which is not in git.
    private let token = (Bundle.main.object(forInfoDictionaryKey: "YomuAPIToken") as? String) ?? ""

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        return URLSession(configuration: config)
    }()

    init() {
        origin = UserDefaults.standard.string(forKey: Self.originKey) ?? Self.defaultOrigin
    }

    private func request(_ path: String, body: [String: Any]) throws -> URLRequest {
        guard !token.isEmpty else {
            throw YomuError.message("No API token is built into this app. Set YOMU_API_TOKEN in ios/Secrets.xcconfig and rebuild.")
        }
        guard let url = URL(string: origin + path) else {
            throw YomuError.message("That server address is not valid.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    private func explainBody(text: String, context: String, level: String) -> [String: Any] {
        ["text": text, "context": String(context.prefix(6000)), "level": level]
    }

    private func describe(_ status: Int) -> String? {
        switch status {
        case 200..<300: return nil
        case 401: return "This app's API token was rejected by the server."
        default: return "The explanation could not be produced. Please retry."
        }
    }

    /// Streams the explanation so text appears in about a second rather than after
    /// the whole answer is generated.
    func explainStream(text: String, context: String, level: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let request = try request("/api/explain-stream",
                                              body: explainBody(text: text, context: context, level: level))
                    let (bytes, response) = try await session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if let problem = describe(status) { throw YomuError.message(problem) }

                    var pending = Data()
                    for try await byte in bytes {
                        pending.append(byte)
                        // Emit only on a complete UTF-8 boundary; Japanese is multi-byte.
                        if let text = String(data: pending, encoding: .utf8) {
                            continuation.yield(text)
                            pending.removeAll(keepingCapacity: true)
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch let error as URLError {
                    continuation.finish(throwing: YomuError.message(
                        error.code == .timedOut
                            ? "The explanation timed out. Please retry."
                            : "Cannot reach Yomu. Check your connection."))
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

enum YomuError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}
