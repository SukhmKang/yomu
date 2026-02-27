// jisho.js — Jisho dictionary API for deterministic word lookup

const Jisho = (() => {
  const JISHO_BASE  = 'https://jisho.org/api/v1/search/words';
  const PROXY       = 'https://api.allorigins.win/raw?url=';
  const MAX_RESULTS = 5;

  /**
   * Search Jisho for a word.
   * @param {string} word
   * @returns {Promise<Array>} parsed candidates, empty array on failure
   */
  async function search(word) {
    try {
      const target = `${JISHO_BASE}?keyword=${encodeURIComponent(word)}`;
      const res = await fetch(`${PROXY}${encodeURIComponent(target)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return parse(data.data ?? []);
    } catch {
      return [];
    }
  }

  /**
   * Parse raw Jisho entries into a clean format.
   * Each entry: { word, reading, meanings, partsOfSpeech, isCommon, allForms }
   */
  function parse(entries) {
    return entries.slice(0, MAX_RESULTS).map(entry => {
      const jp      = entry.japanese?.[0] ?? {};
      const word    = jp.word    ?? jp.reading ?? '';  // null for kana-only words
      const reading = jp.reading ?? jp.word   ?? '';

      // Collect all senses (up to 3)
      const senses = (entry.senses ?? []).slice(0, 3).map(s => ({
        definitions:   s.english_definitions ?? [],
        partsOfSpeech: s.parts_of_speech     ?? [],
        info:          s.info                ?? [],
      }));

      // Primary meaning string for display
      const primaryMeaning = senses[0]?.definitions.join('; ') ?? '';
      const primaryPos     = senses[0]?.partsOfSpeech.join(', ') ?? '';

      // All written forms (for showing alternates like 夜/よる)
      const allForms = (entry.japanese ?? []).map(f => ({
        word:    f.word    ?? null,
        reading: f.reading ?? null,
      }));

      return {
        word,
        reading,
        primaryMeaning,
        primaryPos,
        senses,
        isCommon: !!entry.is_common,
        allForms,
      };
    }).filter(c => c.word || c.reading);
  }

  return { search };
})();
