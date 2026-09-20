import UIKit

/// One text region on the page: what it says, and where it sits as a fraction of
/// the image, so the overlay can place a tap target over it at any zoom.
struct TextRegion: Identifiable, Equatable {
    let id: Int
    let text: String
    let rect: CGRect
}

struct ScannedPage: Equatable {
    let regions: [TextRegion]
    /// The whole page, sent as context so an explanation can see past the selection.
    let fullText: String
}

/// Decodes the Google Vision response the backend proxies.
///
/// Vision is used rather than on-device OCR because it returns paragraph geometry
/// for vertical Japanese. VisionKit reads such text well but exposes no bounds at
/// all, which leaves nothing to tap — and tapping a bubble is the whole interaction.
enum VisionResponse {
    struct Payload: Decodable {
        let fullTextAnnotation: FullText?
        struct FullText: Decodable {
            let text: String?
            let pages: [Page]?
        }
        struct Page: Decodable { let blocks: [Block]? }
        struct Block: Decodable { let paragraphs: [Paragraph]? }
        struct Paragraph: Decodable {
            let words: [Word]?
            let boundingBox: Poly?
        }
        struct Word: Decodable { let symbols: [Symbol]? }
        struct Symbol: Decodable { let text: String? }
        struct Poly: Decodable { let vertices: [Vertex]? }
        struct Vertex: Decodable { let x: Int?; let y: Int? }
    }

    static func parse(_ data: Data, imageSize: CGSize) throws -> ScannedPage {
        let payload = try JSONDecoder().decode(Payload.self, from: data)
        let paragraphs = (payload.fullTextAnnotation?.pages ?? [])
            .flatMap { $0.blocks ?? [] }
            .flatMap { $0.paragraphs ?? [] }

        var regions: [TextRegion] = []
        for paragraph in paragraphs {
            let text = (paragraph.words ?? [])
                .flatMap { $0.symbols ?? [] }
                .compactMap(\.text)
                .joined()
            guard !text.isEmpty,
                  let vertices = paragraph.boundingBox?.vertices, vertices.count >= 3,
                  imageSize.width > 0, imageSize.height > 0 else { continue }

            let xs = vertices.map { CGFloat($0.x ?? 0) }, ys = vertices.map { CGFloat($0.y ?? 0) }
            let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
            guard maxX > minX, maxY > minY else { continue }

            regions.append(TextRegion(
                id: regions.count,
                text: text,
                rect: CGRect(x: minX / imageSize.width,
                             y: minY / imageSize.height,
                             width: (maxX - minX) / imageSize.width,
                             height: (maxY - minY) / imageSize.height)))
        }

        guard !regions.isEmpty else {
            throw YomuError.message("No Japanese text was found on this page.")
        }
        let full = payload.fullTextAnnotation?.text ?? regions.map(\.text).joined(separator: "\n")
        return ScannedPage(regions: regions, fullText: full)
    }
}

/// A downscaled JPEG plus the size it was encoded at. Vision returns coordinates in
/// the space of the image it was given, so boxes must be normalised against this
/// size and not the original — otherwise every tap target lands in the wrong place.
struct EncodedImage {
    let base64: String
    let size: CGSize
}

extension UIImage {
    /// Vision does not need full sensor resolution, and the request body has to stay
    /// well under the serverless limit.
    func downscaledJPEG(maxDimension: CGFloat = 2048, quality: CGFloat = 0.85) -> EncodedImage? {
        let longest = max(size.width, size.height)
        let scale = longest > maxDimension ? maxDimension / longest : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
        guard let data = rendered.jpegData(compressionQuality: quality) else { return nil }
        return EncodedImage(base64: data.base64EncodedString(), size: target)
    }
}
