import Foundation

/// Splits Japanese text into dictionary words.
///
/// NLTagger cannot help here: for Japanese it reports every token as `OtherWord`
/// and returns an empty lemma, so it offers neither part of speech nor a dictionary
/// form. This walks the text taking the longest match at each position; undoing
/// inflections is `LanguageTransformer`'s job.
enum JapaneseSegmenter {
    /// Longest word we will try to match at one position.
    private static let maxWindow = 10

    /// Walk the text left to right, taking the longest match at each position.
    /// `resolve` returns nil when a candidate is not a word worth showing.
    static func segment<T>(_ text: String, resolve: (_ surface: String) -> T?) -> [T] {
        let characters = Array(text)
        var results: [T] = []
        var i = 0
        while i < characters.count {
            guard isJapanese(characters[i]) else { i += 1; continue }
            var matched = false
            let limit = min(maxWindow, characters.count - i)
            for length in stride(from: limit, through: 1, by: -1) {
                let surface = String(characters[i..<(i + length)])
                guard surface.allSatisfy(isJapanese) else { continue }
                if let value = resolve(surface) {
                    results.append(value)
                    i += length
                    matched = true
                    break
                }
            }
            if !matched { i += 1 }
        }
        return results
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
