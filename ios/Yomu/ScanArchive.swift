import Foundation

/// Keeps the last scan — the exact JPEG sent and the exact response — in the app's
/// Documents directory, so segmentation can be debugged against what the app really
/// sent rather than a screenshot of it. One scan, overwritten each time.
enum ScanArchive {
    static func save(image: EncodedImage, response: Data) {
        guard let directory = FileManager.default.urls(for: .documentDirectory,
                                                       in: .userDomainMask).first else { return }
        let meta = """
        {"width":\(Int(image.size.width)),"height":\(Int(image.size.height))}
        """
        try? Data(base64Encoded: image.base64)?.write(to: directory.appendingPathComponent("last-scan.jpg"))
        try? response.write(to: directory.appendingPathComponent("last-scan.json"))
        try? Data(meta.utf8).write(to: directory.appendingPathComponent("last-scan-meta.json"))
    }
}
