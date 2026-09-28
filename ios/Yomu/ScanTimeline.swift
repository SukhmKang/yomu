import Foundation
import Network

/// Timing for one scan, from the shutter press to the bubbles being on screen.
///
/// Marks are taken on a monotonic clock at each hand-off, and the network leg is
/// broken down by `URLSessionTaskMetrics` — the system's own record of DNS,
/// connection, upload, server wait and download — rather than by timers around
/// the call. The whole record is written to the scan archive.
@MainActor
final class ScanTimeline {
    enum Source: String { case camera, library }

    let source: Source
    private let start = ContinuousClock.now
    private var marks: [(name: String, at: Duration)] = []
    private var details: [String: String] = [:]
    private(set) var finished = false

    init(source: Source) {
        self.source = source
        details["source"] = source.rawValue
        details["network"] = NetworkStatus.shared.kind
    }

    func mark(_ name: String) {
        marks.append((name, ContinuousClock.now - start))
    }

    func note(_ key: String, _ value: String) {
        details[key] = value
    }

    /// Milliseconds since the shutter.
    var elapsed: Double { Self.milliseconds(ContinuousClock.now - start) }

    /// Record the network transaction the way the system measured it.
    func note(_ metrics: URLSessionTaskTransactionMetrics) {
        func span(_ from: Date?, _ to: Date?) -> String? {
            guard let from, let to else { return nil }
            return String(Int((to.timeIntervalSince(from) * 1000).rounded()))
        }
        let fields: [(String, String?)] = [
            ("net.dns", span(metrics.domainLookupStartDate, metrics.domainLookupEndDate)),
            ("net.connect", span(metrics.connectStartDate, metrics.connectEndDate)),
            ("net.tls", span(metrics.secureConnectionStartDate, metrics.secureConnectionEndDate)),
            ("net.upload", span(metrics.requestStartDate, metrics.requestEndDate)),
            ("net.wait", span(metrics.requestEndDate, metrics.responseStartDate)),
            ("net.download", span(metrics.responseStartDate, metrics.responseEndDate)),
            ("net.total", span(metrics.fetchStartDate, metrics.responseEndDate)),
        ]
        for (key, value) in fields { if let value { details[key] = value } }
        details["net.reused"] = metrics.isReusedConnection ? "yes" : "no"
        details["net.protocol"] = metrics.networkProtocolName ?? "?"
        details["net.sentKB"] = String(metrics.countOfRequestBodyBytesSent / 1024)
    }

    /// Close the record and write it. Returns total milliseconds.
    @discardableResult
    func finish(scan: String?) -> Double {
        guard !finished else { return elapsed }
        finished = true
        mark("rendered")
        var record = details
        var previous = Duration.zero
        for (name, at) in marks {
            record["at.\(name)"] = String(Int(Self.milliseconds(at)))
            record["step.\(name)"] = String(Int(Self.milliseconds(at - previous)))
            previous = at
        }
        let total = marks.last.map { Self.milliseconds($0.at) } ?? elapsed
        record["total"] = String(Int(total))
        ScanArchive.log(scan: scan, event: "timing", detail: record)
        ScanArchive.appendTiming(scan: scan, record: record)
        return total
    }

    private static func milliseconds(_ duration: Duration) -> Double {
        let (seconds, attoseconds) = duration.components
        return Double(seconds) * 1000 + Double(attoseconds) / 1e15
    }
}

/// Wi-Fi or cellular at the moment of a scan, since the two differ by seconds.
final class NetworkStatus: @unchecked Sendable {
    static let shared = NetworkStatus()

    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var current = "unknown"

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let kind: String
            if path.status != .satisfied { kind = "offline" }
            else if path.usesInterfaceType(.wifi) { kind = "wifi" }
            else if path.usesInterfaceType(.cellular) { kind = "cellular" }
            else if path.usesInterfaceType(.wiredEthernet) { kind = "wired" }
            else { kind = "other" }
            self?.lock.withLock { self?.current = kind }
        }
        monitor.start(queue: DispatchQueue(label: "yomu.network"))
    }

    var kind: String { lock.withLock { current } }
}

/// Collects the transaction metrics for one request.
final class MetricsCollector: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var collected: URLSessionTaskTransactionMetrics?

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didFinishCollecting metrics: URLSessionTaskMetrics) {
        lock.withLock { collected = metrics.transactionMetrics.last }
    }

    /// Metrics arrive around when the response does; allow them a moment.
    func metrics() async -> URLSessionTaskTransactionMetrics? {
        for _ in 0..<20 {
            if let value = lock.withLock({ collected }) { return value }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return nil
    }
}
