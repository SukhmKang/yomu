import Foundation

/// Keeps a short history of what the app actually sent and received, so a page that
/// reads wrongly can be diagnosed from the real request rather than a screenshot.
///
/// History rather than one slot: an earlier version overwrote on every scan, so by
/// the time a problem was reported the evidence had already been replaced.
enum ScanArchive {
    /// Enough to cover a reading session without filling the device.
    private static let keep = 12

    private static let queue = DispatchQueue(label: "yomu.archive")

    private static var root: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("scans", isDirectory: true)
    }

    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HHmmss"
        return formatter
    }()

    /// Returns the folder this scan was filed under, so later events can join it.
    @discardableResult
    static func save(image: EncodedImage, response: Data) -> String {
        let name = stamp.string(from: Date())
        queue.async {
            guard let root else { return }
            let folder = root.appendingPathComponent(name, isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if let jpeg = Data(base64Encoded: image.base64) {
                try? jpeg.write(to: folder.appendingPathComponent("scan.jpg"))
            }
            try? response.write(to: folder.appendingPathComponent("vision.json"))
            let meta = #"{"width":\#(Int(image.size.width)),"height":\#(Int(image.size.height))}"#
            try? Data(meta.utf8).write(to: folder.appendingPathComponent("meta.json"))
            prune()
        }
        return name
    }

    /// One line per thing the reader did, appended beside its scan: what was
    /// selected, which model answered, and what came back or failed.
    static func log(scan: String?, event: String, detail: [String: String]) {
        queue.async {
            guard let root, let scan else { return }
            var fields = detail
            fields["at"] = ISO8601DateFormatter().string(from: Date())
            fields["event"] = event
            guard let line = try? JSONSerialization.data(withJSONObject: fields) else { return }

            let file = root.appendingPathComponent(scan, isDirectory: true)
                .appendingPathComponent("events.jsonl")
            if let handle = try? FileHandle(forWritingTo: file) {
                defer { try? handle.close() }
                try? handle.seekToEnd()
                try? handle.write(contentsOf: line + Data("\n".utf8))
            } else {
                try? (line + Data("\n".utf8)).write(to: file)
            }
        }
    }

    private static func prune() {
        guard let root,
              let folders = try? FileManager.default.contentsOfDirectory(
                at: root, includingPropertiesForKeys: nil) else { return }
        // Names sort chronologically, so the oldest are simply the first.
        for folder in folders.map(\.lastPathComponent).sorted().dropLast(keep) {
            try? FileManager.default.removeItem(at: root.appendingPathComponent(folder))
        }
    }
}
