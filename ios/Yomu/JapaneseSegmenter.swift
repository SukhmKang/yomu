import Foundation

/// Splits Japanese text into dictionary words.
///
/// NLTagger cannot help here: for Japanese it reports every token as `OtherWord`
/// and returns an empty lemma, so it offers neither part of speech nor a dictionary
/// form. Instead this does longest-match segmentation straight against JMdict,
/// undoing common inflections so 会って resolves to 会う.
enum JapaneseSegmenter {
    /// Longest word we will try to match at one position.
    private static let maxWindow = 10

    /// Godan verbs shift their final kana between vowel rows as they inflect.
    private static let toU: [Character: Character] = [
        // あ row (negative stems): 書か-ない → 書く
        "か": "く", "が": "ぐ", "さ": "す", "た": "つ", "な": "ぬ",
        "ば": "ぶ", "ま": "む", "ら": "る", "わ": "う",
        // い row (polite stems): 書き-ます → 書く
        "き": "く", "ぎ": "ぐ", "し": "す", "ち": "つ", "に": "ぬ",
        "び": "ぶ", "み": "む", "り": "る", "い": "う",
        // え row (conditional/potential stems): 書け-ば → 書く
        "け": "く", "げ": "ぐ", "せ": "す", "て": "つ", "ね": "ぬ",
        "べ": "ぶ", "め": "む", "れ": "る", "え": "う",
    ]

    /// Suffix to strip, and the endings to try in its place. Longest first, because
    /// ません must be tried before ます and なかった before た.
    private static let rules: [(suffix: String, endings: [String])] = [
        ("ませんでした", ["る", ""]), ("ましょう", ["る", ""]),
        ("ません", ["る", ""]), ("ました", ["る", ""]), ("ます", ["る", ""]),
        ("なかった", ["る", "", "ない"]), ("なくて", ["る", ""]), ("ない", ["る", ""]),
        ("かった", ["い"]), ("くない", ["い"]), ("くて", ["い"]), ("く", ["い"]),
        ("ている", ["る"]), ("ていた", ["る"]), ("てる", ["る"]), ("てた", ["る"]),
        ("でいる", ["ぬ", "ぶ", "む"]), ("でる", ["ぬ", "ぶ", "む"]),
        ("させる", ["る"]), ("られる", ["る"]), ("せる", ["す", "る"]), ("れる", ["る"]),
        ("たい", ["る", ""]), ("たら", ["る", ""]), ("れば", ["る", ""]), ("ば", ["", "る"]),
        ("った", ["う", "つ", "る"]), ("って", ["う", "つ", "る"]),
        ("いた", ["く"]), ("いて", ["く"]), ("いだ", ["ぐ"]), ("いで", ["ぐ"]),
        ("した", ["す", "する"]), ("して", ["す", "する"]),
        ("んだ", ["ぬ", "ぶ", "む"]), ("んで", ["ぬ", "ぶ", "む"]),
        ("た", ["る"]), ("て", ["る"]),
    ]

    /// Candidate dictionary forms for a surface form, most likely first.
    static func dictionaryForms(of word: String) -> [String] {
        var forms = [word]
        for (suffix, endings) in rules {
            guard word.count > suffix.count, word.hasSuffix(suffix) else { continue }
            let stem = String(word.dropLast(suffix.count))
            for ending in endings {
                // Godan stems move their final kana back to the う row, and that
                // reading is likelier than the bare stem, which is often a noun.
                if ending.isEmpty, let last = stem.last, let shifted = toU[last] {
                    forms.append(String(stem.dropLast()) + String(shifted))
                }
                forms.append(stem + ending)
            }
        }
        var seen = Set<String>()
        return forms.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// Walk the text left to right, taking the longest match at each position.
    /// `resolve` returns nil when a candidate is not a word worth showing.
    static func segment<T>(_ text: String, resolve: (_ surface: String, _ forms: [String]) -> T?) -> [T] {
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
                if let value = resolve(surface, dictionaryForms(of: surface)) {
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
