import Foundation
import SQLite3

struct VocabularyEntry: Identifiable, Equatable {
    let id = UUID()
    let surface: String      // as it appears on the page
    let word: String         // dictionary headword
    let reading: String
    let meaning: String
    let partOfSpeech: String

    var isInflected: Bool { surface != word }

    static func == (a: VocabularyEntry, b: VocabularyEntry) -> Bool {
        a.surface == b.surface && a.word == b.word && a.reading == b.reading
    }
}

/// JMdict, bundled as SQLite. Lookups are local, instant, and work offline — the web
/// version fetched one of 256 dictionary shards over the network per word.
actor JapaneseDictionary {
    static let shared = JapaneseDictionary()

    private let databasePath: String?
    private let transformer: LanguageTransformer?
    private var db: OpaquePointer?
    private var opened = false

    init(databasePath: String? = Bundle.main.path(forResource: "jmdict", ofType: "sqlite"),
         transformer: LanguageTransformer? = LanguageTransformer.japanese) {
        self.databasePath = databasePath
        self.transformer = transformer
    }

    /// Every form a surface could be an inflection of, the surface itself first so
    /// a word that is already a headword is not de-inflected past its own entry.
    private func candidates(for surface: String) -> [String] {
        var seen = Set<String>()
        var forms = [surface]
        seen.insert(surface)
        for candidate in transformer?.transform(surface) ?? [] where seen.insert(candidate.text).inserted {
            forms.append(candidate.text)
        }
        return forms
    }

    /// Grammar, not vocabulary — showing a gloss for these is noise.
    /// Exactly as spelled in the built dictionary — "auxiliary verb" and "copula"
    /// were guessed and match nothing, so this filter silently passed everything.
    private static let skippedPartsOfSpeech: Set<String> = [
        "particle", "aux verb", "conjunction", "interjection",
    ]

    /// Words that segment out of inflections and only ever mislead as glosses.
    private static let stopWords: Set<String> = [
        "する", "なる", "ある", "いる", "おる", "です", "ます", "そう", "よう",
        "為れる", "為る", "居る", "有る",
    ]

    private func open() {
        guard !opened else { return }
        opened = true
        guard let path = databasePath else { return }
        if sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) != SQLITE_OK { db = nil }
    }

    /// Content words in `text`, in reading order, de-duplicated.
    func entries(in text: String) -> [VocabularyEntry] {
        open()
        guard db != nil else { return [] }

        var seen = Set<String>()
        let found = JapaneseSegmenter.segment(text) { surface -> VocabularyEntry? in
            for form in candidates(for: surface) {
                guard let row = lookup(form), isWorthShowing(row, matched: form) else { continue }
                return VocabularyEntry(surface: surface,
                                       word: row.word,
                                       reading: row.reading,
                                       meaning: row.meaning,
                                       partOfSpeech: row.partOfSpeech)
            }
            return nil
        }

        var results: [VocabularyEntry] = []
        for entry in found where seen.insert(entry.word + entry.reading).inserted {
            results.append(entry)
            if results.count == 20 { break }
        }
        return results
    }

    /// `matched` is the dictionary form that actually hit, which is the honest
    /// measure of how much text the entry explains. ていれば matches on てい, and a
    /// two-kana stem finding 鼎 "bronze vessel" is a homograph, not a reading.
    private func isWorthShowing(_ row: Row, matched: String) -> Bool {
        if Self.skippedPartsOfSpeech.contains(row.partOfSpeech) { return false }
        if Self.stopWords.contains(row.word) { return false }

        let allKana = matched.allSatisfy(JapaneseSegmenter.isKana)
        // Kana runs are where longest-match goes wrong, because inflections and
        // particles collide with rare headwords: やって found 夜雨 "night rain",
        // はならなかった found 離る. A kanji surface is unambiguous enough to trust,
        // so only kana runs have to clear the common-word bar.
        if allKana && !row.isCommon { return false }
        // A lone kana is a particle or an inflection fragment, never a word to learn.
        if allKana && matched.count < 2 { return false }
        // A short kana run matching a kanji headword is usually a homograph or an
        // inflection caught mid-word: こと finds 琴 "koto zither", いれば finds
        // 入れ歯 "false tooth". Longer runs are genuine — いちおう really is 一応.
        if allKana && matched.count < 4 && JapaneseSegmenter.containsKanji(row.word) { return false }
        return true
    }

    private struct Row { let word, reading, meaning, partOfSpeech: String; let isCommon: Bool }

    private func lookup(_ key: String) -> Row? {
        guard let db else { return nil }
        var statement: OpaquePointer?
        let sql = "SELECT word, reading, meaning, pos, common FROM entries WHERE key = ? LIMIT 1"
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        // SQLITE_TRANSIENT: sqlite must copy the text, it does not outlive this call.
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, key, -1, transient)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        func column(_ i: Int32) -> String {
            guard let c = sqlite3_column_text(statement, i) else { return "" }
            return String(cString: c)
        }
        return Row(word: column(0), reading: column(1), meaning: column(2),
                   partOfSpeech: column(3), isCommon: sqlite3_column_int(statement, 4) == 1)
    }
}
