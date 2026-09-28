import Foundation
import SQLite3

struct VocabularyEntry: Identifiable, Equatable {
    let id = UUID()
    let surface: String      // as it appears on the page
    let word: String         // dictionary headword
    let reading: String
    let meaning: String
    let partOfSpeech: String
    /// Every entry the surface matched, best first, one per headword — the list
    /// Yomitan shows. The first is the one summarised above.
    let candidates: [DictionaryCandidate]

    var isInflected: Bool { surface != word }

    static func == (a: VocabularyEntry, b: VocabularyEntry) -> Bool {
        a.surface == b.surface && a.word == b.word && a.reading == b.reading
    }
}

struct DictionaryCandidate: Identifiable, Hashable {
    var id: String { "\(word)\t\(reading)" }
    let word: String
    let reading: String
    let senses: [String]
    let partOfSpeech: String
    /// The dictionary form the surface was de-inflected to, when it was.
    let viaForm: String?
    /// JPDB rank; lower is more common.
    let frequency: Int?
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
    /// Every form a surface could be an inflection of, with the grammatical
    /// conditions the chain arrived at. The surface itself comes first, with no
    /// conditions, so it matches any entry.
    private func candidates(for surface: String) -> [LanguageTransformer.TransformedText] {
        transformer?.transform(surface)
            ?? [LanguageTransformer.TransformedText(text: surface, conditions: 0, steps: 0)]
    }

    /// Yomitan's `_sortTermDictionaryEntries`, for the tiers this data carries:
    /// shorter inflection chain, then an exact match of the text as written, then
    /// frequency (lower rank is more common; none sorts last), then score.
    /// Source length is the segmenter's longest match; reading-match and
    /// text-processing tiers have no counterpart here.
    private static func yomitanOrder(surface: String)
        -> ((steps: Int, form: String, row: Row), (steps: Int, form: String, row: Row)) -> Bool {
        { a, b in
            if a.steps != b.steps { return a.steps < b.steps }
            let exactA = a.row.word == surface, exactB = b.row.word == surface
            if exactA != exactB { return exactA }
            let freqA = a.row.frequency ?? .max, freqB = b.row.frequency ?? .max
            if freqA != freqB { return freqA < freqB }
            return a.row.score > b.row.score
        }
    }

    /// Yomitan's `_matchEntriesToDeinflections`: a de-inflected form is only
    /// accepted by an entry whose own grammatical class the chain could have
    /// produced. いたら comes from an ichidan verb, so it finds 居る (v1) and not
    /// 入る (v5); 離る has no modern class, so no inflection reaches it.
    private func matches(_ row: Row, conditions: Int) -> Bool {
        guard let transformer else { return conditions == 0 }
        let parts = row.rules.split(separator: " ").map(String.init)
        return LanguageTransformer.conditionsMatch(conditions,
                                                   transformer.conditionFlags(forPartsOfSpeech: parts))
    }

    /// Grammar, not vocabulary — showing a gloss for these is noise.
    /// Jitendex part-of-speech codes that are grammar rather than vocabulary. An
    /// entry is left out only when *every* code it carries is one of these: いる
    /// is tagged aux-v as well as v1, and is still a word worth showing.
    private static let grammaticalCodes: Set<String> = [
        "prt", "conj", "aux", "aux-v", "aux-adj", "cop",
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
        let found = JapaneseSegmenter.segment(text) { surface -> JapaneseSegmenter.Match<VocabularyEntry> in
            // Every form the surface could be, and every entry each form reaches,
            // ranked together as Yomitan does — not first form wins. なって is both
            // なう and なる at one step; frequency is what separates them.
            var matched: [(steps: Int, form: String, row: Row)] = []
            for candidate in candidates(for: surface) {
                for row in lookup(candidate.text) where matches(row, conditions: candidate.conditions) {
                    matched.append((candidate.steps, candidate.text, row))
                }
            }
            let ranked = matched.sorted(by: Self.yomitanOrder(surface: surface))
            guard let best = ranked.first?.row else { return .none }
            // Rank first, then decide whether to show: filtering before choosing
            // promoted runners-up — the particle から ranked first, was dropped, and
            // 殻 "shell" took its place.
            guard isWorthShowing(best, matched: surface) else { return .skip }
            // The whole ranked list, one row per headword as Yomitan groups them. A
            // headword reached through several forms keeps its best-ranked match.
            var seen = Set<String>()
            let candidates = ranked.compactMap { match -> DictionaryCandidate? in
                let row = match.row
                guard seen.insert("\(row.word)\t\(row.reading)").inserted else { return nil }
                return DictionaryCandidate(word: row.word,
                                           reading: row.reading,
                                           senses: row.senses,
                                           partOfSpeech: row.partOfSpeech,
                                           viaForm: match.form == surface ? nil : match.form,
                                           frequency: row.frequency)
            }
            return .word(VocabularyEntry(surface: surface,
                                         word: best.word,
                                         reading: best.reading,
                                         meaning: best.meaning,
                                         partOfSpeech: best.partOfSpeech,
                                         candidates: candidates))
            return .none
        }

        // Every word, not the first twenty: a swept selection used to stop silently
        // part way, so the end of what you picked had no vocabulary at all.
        return found.filter { seen.insert($0.word + $0.reading).inserted }
    }

    /// `matched` is the dictionary form that actually hit, which is the honest
    /// measure of how much text the entry explains. ていれば matches on てい, and a
    /// two-kana stem finding 鼎 "bronze vessel" is a homograph, not a reading.
    private func isWorthShowing(_ row: Row, matched: String) -> Bool {
        let codes = row.partOfSpeech.split(separator: " ").map(String.init)
        if !codes.isEmpty && codes.allSatisfy(Self.grammaticalCodes.contains) { return false }
        if Self.stopWords.contains(row.word) { return false }

        let allKana = matched.allSatisfy(JapaneseSegmenter.isKana)
        // A lone kana is a particle or an inflection fragment, never a word to learn.
        if allKana && matched.count < 2 { return false }
        return true
    }

    private struct Row {
        let word, reading, meaning, partOfSpeech: String
        let isCommon: Bool
        /// Yomitan rule codes — v5, v1, adj-i — from Jitendex.
        let rules: String
        let score: Int
        /// JPDB rank; lower is more common.
        let frequency: Int?
        let senses: [String]
    }

    /// Candidates for a key, best first. Several are kept because the ranking
    /// cannot always be right: an earlier build stored one row per key, so a wrong
    /// pick was the only answer and had to be suppressed downstream.
    private func lookup(_ key: String) -> [Row] {
        guard let db else { return [] }
        var statement: OpaquePointer?
        let sql = """
            SELECT word, reading, meaning, pos, common, rules, score, freq, senses FROM entries
            WHERE key = ? ORDER BY rank
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
                            partOfSpeech: column(3), isCommon: sqlite3_column_int(statement, 4) == 1,
                            rules: column(5), score: Int(sqlite3_column_int(statement, 6)),
                            frequency: sqlite3_column_type(statement, 7) == SQLITE_NULL
                                ? nil : Int(sqlite3_column_int(statement, 7)),
                            senses: column(8).split(separator: "\n").map(String.init)))
        }
        return rows
    }
}
