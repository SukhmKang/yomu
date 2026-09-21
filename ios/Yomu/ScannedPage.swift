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
        struct FullText: Decodable { let pages: [Page]? }
        struct Page: Decodable { let blocks: [Block]? }
        struct Block: Decodable { let paragraphs: [Paragraph]? }
        struct Paragraph: Decodable { let words: [Word]? }
        struct Word: Decodable { let symbols: [Symbol]? }
        struct Symbol: Decodable {
            let text: String?
            let boundingBox: Poly?
            let property: Property?
            struct Property: Decodable { let detectedBreak: Break? }
            struct Break: Decodable { let type: String? }
        }
        struct Poly: Decodable { let vertices: [Vertex]? }
        struct Vertex: Decodable { let x: Int?; let y: Int? }
    }

    private struct Glyph { let text: String; let rect: CGRect; let endsLine: Bool }
    private struct Line { let text: String; let rect: CGRect; let isVertical: Bool }

    static func parse(_ data: Data, imageSize: CGSize) throws -> ScannedPage {
        let payload = try JSONDecoder().decode(Payload.self, from: data)
        guard imageSize.width > 0, imageSize.height > 0 else {
            throw YomuError.message("That photo could not be read.")
        }

        let glyphs = (payload.fullTextAnnotation?.pages ?? [])
            .flatMap { $0.blocks ?? [] }
            .flatMap { $0.paragraphs ?? [] }
            .flatMap { $0.words ?? [] }
            .flatMap { $0.symbols ?? [] }
            .compactMap(glyph)

        let lines = buildLines(glyphs).filter { isMeaningful($0.text) }
        let kept = inReadingOrder(dropRuby(from: lines))
        guard !kept.isEmpty else {
            throw YomuError.message("No Japanese text was found on this page.")
        }

        let regions = kept.enumerated().map { index, line in
            TextRegion(id: index, text: line.text,
                       rect: CGRect(x: line.rect.minX / imageSize.width,
                                    y: line.rect.minY / imageSize.height,
                                    width: line.rect.width / imageSize.width,
                                    height: line.rect.height / imageSize.height))
        }
        return ScannedPage(regions: regions,
                           fullText: regions.map(\.text).joined(separator: "\n"))
    }

    private static func glyph(_ symbol: Payload.Symbol) -> Glyph? {
        guard let text = symbol.text, !text.isEmpty,
              let vertices = symbol.boundingBox?.vertices, vertices.count >= 3 else { return nil }
        let xs = vertices.map { CGFloat($0.x ?? 0) }, ys = vertices.map { CGFloat($0.y ?? 0) }
        let minX = xs.min()!, maxX = xs.max()!, minY = ys.min()!, maxY = ys.max()!
        guard maxX > minX, maxY > minY else { return nil }
        // SPACE continues the line; LINE_BREAK and EOL_SURE_SPACE end it.
        let ends = ["LINE_BREAK", "EOL_SURE_SPACE"].contains(symbol.property?.detectedBreak?.type ?? "")
        return Glyph(text: text,
                     rect: CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY),
                     endsLine: ends)
    }

    /// Group glyphs into lines using Vision's own line breaks.
    ///
    /// Vision marks the end of every line on the symbol itself, and that
    /// segmentation is right even where its paragraph grouping is wrong: on this
    /// novel page it merged six columns into one block, yet still marked all
    /// thirteen line ends correctly. Reading the markers is its answer to the
    /// problem; clustering the boxes here would be guessing at it.
    private static func buildLines(_ glyphs: [Glyph]) -> [Line] {
        var lines: [Line] = []
        var text = ""
        var rect: CGRect?

        for glyph in glyphs {
            text += glyph.text
            rect = rect.map { $0.union(glyph.rect) } ?? glyph.rect
            guard glyph.endsLine else { continue }
            if let bounds = rect, !text.isEmpty {
                lines.append(Line(text: text, rect: bounds,
                                  isVertical: bounds.height > bounds.width))
            }
            text = ""
            rect = nil
        }
        if let bounds = rect, !text.isEmpty {
            lines.append(Line(text: text, rect: bounds, isVertical: bounds.height > bounds.width))
        }
        return lines
    }

    /// A photographed page brings its surroundings with it. One scan picked up the
    /// keycaps of the laptop the book was resting on — "Hyperorcommand", "control",
    /// "option" — which reached the explanation as page context and got discussed
    /// as if it were dialogue. Nothing without kana or kanji is worth reading here,
    /// so regions are kept only if they contain some.
    private static func isMeaningful(_ text: String) -> Bool {
        text.unicodeScalars.contains {
            (0x3040...0x30FF).contains($0.value) || (0x4E00...0x9FFF).contains($0.value)
        }
    }

    /// Furigana are regions of their own, and Vision often emits them first, so a
    /// merged selection would lead with ruby before the text it annotates. Ruby is
    /// set far smaller than its base text and sits alongside the column it belongs
    /// to — on a real page, 16pt wide against 52–65pt for the columns themselves.
    private static func dropRuby(from boxes: [Line]) -> [Line] {
        let vertical = boxes.filter(\.isVertical)
        guard vertical.count > 1 else { return boxes }

        let widths = vertical.map(\.rect.width).sorted()
        let median = widths[widths.count / 2]
        guard median > 0 else { return boxes }

        return boxes.filter { box in
            guard box.isVertical else { return true }
            guard box.rect.width < median * 0.55 else { return true }     // full-size column
            // Only drop it if it actually annotates a neighbouring column.
            return !boxes.contains { other in
                other.isVertical && other.rect != box.rect
                    && other.rect.width > box.rect.width * 1.6
                    && abs(other.rect.midX - box.rect.midX) < (other.rect.width + box.rect.width) * 1.5
                    && other.rect.minY < box.rect.maxY && box.rect.minY < other.rect.maxY
            }
        }
    }

    /// Order the page the way it is read.
    ///
    /// Sorting the whole page right to left is wrong, because a page is rows of
    /// panels: on one real page it put 野武士だろうと first, from the bottom panel,
    /// purely because that bubble sat furthest right — so the dialogue reached the
    /// explanation out of sequence. Regions are banded into rows by vertical
    /// overlap, rows run top to bottom, and within a row it is right to left.
    ///
    /// A panel tall enough to span several rows will merge them back into one band,
    /// which is no worse than sorting globally.
    private static func inReadingOrder(_ boxes: [Line]) -> [Line] {
        var bands: [[Line]] = []
        var bandBottom: CGFloat = -.greatestFiniteMagnitude

        for box in boxes.sorted(by: { $0.rect.minY < $1.rect.minY }) {
            if !bands.isEmpty, box.rect.minY < bandBottom {
                bands[bands.count - 1].append(box)
                bandBottom = max(bandBottom, box.rect.maxY)
            } else {
                bands.append([box])
                bandBottom = box.rect.maxY
            }
        }
        return bands.flatMap { $0.sorted { $0.rect.midX > $1.rect.midX } }
    }
}


