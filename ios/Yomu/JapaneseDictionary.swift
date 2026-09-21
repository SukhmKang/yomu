import Foundation
import SQLite3

struct VocabularyEntry: Identifiable, Equatable {
    let id = UUID()
    let surface: String      // as it appears on the page
    let word: String         // dictionary headword
    let reading: String
    let meaning: String
    let partOfSpeech: String
    /// Other headwords sharing this reading, when the dictionary cannot separate
    /// them — こと is both 事 "thing" and 琴 "koto", with identical popularity.
    let alternatives: [String]

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
    private func candidates(for surface: String) -> [(form: String, isInflected: Bool)] {
        var seen: Set<String> = [surface]
        var forms = [(form: surface, isInflected: false)]
        for candidate in transformer?.transform(surface) ?? [] where seen.insert(candidate.text).inserted {
            forms.append((form: candidate.text, isInflected: candidate.conditions != 0))
        }
        return forms
    }

    /// Only verbs and i-adjectives inflect, so a form reached by de-inflection has
    /// to land on one. Without this, やっていれば reached 奴 "fellow" — a noun that
    /// no inflection could have produced. Yomitan checks the entry's part of speech
    /// against the chain's grammatical conditions; this is the coarse version, since
    /// the built dictionary records only "verb", "noun" and the like.
    private static func canInflect(_ partOfSpeech: String) -> Bool {
        // "expression" covers verb phrases such as やって来る, which inflect like
        // the verb they end in; excluding it lost やってくれ → やって来る.
        partOfSpeech.contains("verb") || partOfSpeech.contains("adjective")
            || partOfSpeech == "expression"
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
            for candidate in candidates(for: surface) {
                let form = candidate.form
                let usable = lookup(form).filter {
                    isWorthShowing($0, matched: form)
                        && (!candidate.isInflected || Self.canInflect($0.partOfSpeech))
                }
                guard let best = usable.first else { continue }
                // A different headword with a different gloss is a real alternative;
                // 箏 beside 琴 is the same word spelled differently, so it is not.
                let alternatives = usable.dropFirst()
                    .filter { $0.meaning != best.meaning }
                    .prefix(1)
                    .map { "\($0.word) \($0.meaning)" }
                return VocabularyEntry(surface: surface,
                                       word: best.word,
                                       reading: best.reading,
                                       meaning: best.meaning,
                                       partOfSpeech: best.partOfSpeech,
                                       alternatives: Array(alternatives))
            }
            return nil
        }

        // Every word, not the first twenty: a swept selection used to stop silently
        // part way, so the end of what you picked had no vocabulary at all.
        return found.filter { seen.insert($0.word + $0.reading).inserted }
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
        return true
    }

    private struct Row {
        let word, reading, meaning, partOfSpeech: String
        let isCommon: Bool
    }

    /// Candidates for a key, best first. Several are kept because the ranking
    /// cannot always be right: an earlier build stored one row per key, so a wrong
    /// pick was the only answer and had to be suppressed downstream.
    private func lookup(_ key: String) -> [Row] {
        guard let db else { return [] }
        var statement: OpaquePointer?
        let sql = """
            SELECT word, reading, meaning, pos, common FROM entries
            WHERE key = ? ORDER BY rank LIMIT 4
            """
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(statement) }
        // SQLITE_TRANSIENT: sqlite must copy the text, it does not outlive this call.
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, key, -1, transient)

        var rows: [Row] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            func column(_ i: Int32) -> String {
                guard let c = sqlite3_column_text(statement, i) else { return "" }
                return String(cString: c)
            }
            rows.append(Row(word: column(0), reading: column(1), meaning: column(2),
                            partOfSpeech: column(3), isCommon: sqlite3_column_int(statement, 4) == 1))
        }
        return rows
    }
}
