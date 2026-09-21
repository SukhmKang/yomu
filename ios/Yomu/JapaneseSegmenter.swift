import Foundation
import NaturalLanguage

/// Splits Japanese text into dictionary words.
///
/// Matching runs between token boundaries from `NLTokenizer`, longest first.
/// Without that barrier, longest-match mines words out of the middle of anything
/// the dictionary does not contain — ハンブルク (Hamburg, absent) yielded ブル
/// "bull". Apple's tokenizer keeps such runs whole, and its boundaries are
/// morphological: くぐり抜け|て, なら|なかっ|た, 三十|七|歳.
///
/// It is used only for boundaries. `NLTagger` labels every Japanese token
/// `OtherWord` with an empty lemma, so part of speech and dictionary form come
/// from the dictionary and `LanguageTransformer` instead.
enum JapaneseSegmenter {
    /// Longest word we will try to match at one position.
    private static let maxWindow = 10

    /// Walk the text left to right, taking the longest match at each token start.
    /// `resolve` returns nil when a candidate is not a word worth showing.
    static func segment<T>(_ text: String, resolve: (_ surface: String) -> T?) -> [T] {
        let characters = Array(text)
        let boundaries = tokenBoundaries(in: text, count: characters.count)
        var results: [T] = []
        var start = 0

        while start < characters.count {
            // Only start on a boundary, so nothing is taken out of a word's middle.
            guard boundaries.contains(start), isJapanese(characters[start]) else {
                start += 1
                continue
            }
            var matched = false
            let limit = min(maxWindow, characters.count - start)
            for length in stride(from: limit, through: 1, by: -1) {
                // …and end on one, so a match cannot run into the next word.
                guard boundaries.contains(start + length) else { continue }
                let surface = String(characters[start..<(start + length)])
                guard surface.allSatisfy(isJapanese) else { continue }
                if let value = resolve(surface) {
                    results.append(value)
                    start += length
                    matched = true
                    break
                }
            }
            if !matched { start += 1 }
        }
        return results
    }

    /// Character offsets where a token begins or ends, including both extremes.
    private static func tokenBoundaries(in text: String, count: Int) -> Set<Int> {
        var boundaries: Set<Int> = [0, count]
        let tokenizer = NLTokenizer(unit: .word)
        tokenizer.string = text
        tokenizer.setLanguage(.japanese)
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            boundaries.insert(text.distance(from: text.startIndex, to: range.lowerBound))
            boundaries.insert(text.distance(from: text.startIndex, to: range.upperBound))
            return true
        }
        return boundaries
    }

    static func isJapanese(_ c: Character) -> Bool {
        guard let s = c.unicodeScalars.first, c.unicodeScalars.count == 1 else { return false }
        return (0x3040...0x30FF).contains(s.value)   // kana
            || (0x4E00...0x9FFF).contains(s.value)   // CJK ideographs
            || (0x3005...0x3006).contains(s.value)   // 々 and 〆
    }

    static func isKana(_ c: Character) -> Bool {
        guard let s = c.unicodeScalars.first else { return false }
        return (0x3040...0x30FF).contains(s.value)
    }

    static func containsKanji(_ s: String) -> Bool {
        s.unicodeScalars.contains { (0x4E00...0x9FFF).contains($0.value) }
    }
}
