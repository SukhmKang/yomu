import CoreGraphics
import Foundation

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

        var boxes: [(text: String, rect: CGRect)] = []
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
            guard maxX > minX, maxY > minY, isMeaningful(text) else { continue }
            boxes.append((text, CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)))
        }

        let kept = dropRuby(from: boxes).sorted { readingOrder($0.rect, $1.rect) }
        guard !kept.isEmpty else {
            throw YomuError.message("No Japanese text was found on this page.")
        }

        let regions = kept.enumerated().map { index, box in
            TextRegion(id: index, text: box.text,
                       rect: CGRect(x: box.rect.minX / imageSize.width,
                                    y: box.rect.minY / imageSize.height,
                                    width: box.rect.width / imageSize.width,
                                    height: box.rect.height / imageSize.height))
        }
        // Rebuild the page text in reading order too, so the explanation's context
        // is not the raw Vision ordering.
        let full = regions.map(\.text).joined(separator: "\n")
        return ScannedPage(regions: regions, fullText: full)
    }

    /// Artwork produces stray one- and two-character hits — a brush stroke read as
    /// "C". Anything with kana or kanji is kept; a short Latin fragment is not.
    private static func isMeaningful(_ text: String) -> Bool {
        let japanese = text.unicodeScalars.contains {
            (0x3040...0x30FF).contains($0.value) || (0x4E00...0x9FFF).contains($0.value)
        }
        return japanese || text.count >= 3
    }

    /// Furigana are regions of their own, and Vision often emits them first, so a
    /// merged selection would lead with ruby before the text it annotates. Ruby is
    /// set far smaller than its base text and sits alongside the column it belongs
    /// to — on a real page, 16pt wide against 52–65pt for the columns themselves.
    private static func dropRuby(from boxes: [(text: String, rect: CGRect)]) -> [(text: String, rect: CGRect)] {
        let vertical = boxes.filter { $0.rect.height > $0.rect.width }
        guard vertical.count > 1 else { return boxes }

        let widths = vertical.map(\.rect.width).sorted()
        let median = widths[widths.count / 2]
        guard median > 0 else { return boxes }

        return boxes.filter { box in
            guard box.rect.height > box.rect.width else { return true }   // horizontal text
            guard box.rect.width < median * 0.55 else { return true }     // full-size column
            // Only drop it if it actually annotates a neighbouring column.
            return !boxes.contains { other in
                other.rect != box.rect
                    && other.rect.width > box.rect.width * 1.6
                    && abs(other.rect.midX - box.rect.midX) < (other.rect.width + box.rect.width) * 1.5
                    && other.rect.minY < box.rect.maxY && box.rect.minY < other.rect.maxY
            }
        }
    }

    /// Japanese reads right to left by column, then top to bottom. Columns whose
    /// horizontal spans overlap belong to the same column and order vertically.
    private static func readingOrder(_ a: CGRect, _ b: CGRect) -> Bool {
        if a.minX > b.maxX { return true }
        if b.minX > a.maxX { return false }
        return a.minY < b.minY
    }
}
