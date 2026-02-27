// dict.js — local JMdict lookup (replaces Jisho API)
// Loads dict/index.json once, caches in memory for the session.

const Dict = (() => {
  const INDEX_URL = 'dict/index.json';

  let index   = null;   // in-memory after first load
  let promise = null;   // in-flight fetch/parse promise

  /**
   * Load the index (once). Subsequent calls return the cached result.
   */
  function load() {
    if (index)   return Promise.resolve(index);
    if (promise) return promise;

    promise = fetch(INDEX_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Dict fetch failed: ${r.status}`);
        return r.json();
      })
      .then(data => {
        index   = data;
        promise = null;
        return index;
      });

    return promise;
  }

  /**
   * Kick off loading in the background (call on app init so it's ready sooner).
   */
  function preload() {
    load().catch(() => {});
  }

  /**
   * Look up a word. Returns an array of candidates in the same shape
   * that Jisho used to return, so the rest of the app needs no changes.
   *
   * @param {string} word
   * @returns {Promise<Array>}
   */
  async function search(word) {
    try {
      const idx     = await load();
      const entries = idx[word];
      if (!entries || entries.length === 0) return [];

      return entries.map(e => ({
        word:           e.w,
        reading:        e.r,
        primaryMeaning: e.m,
        primaryPos:     e.p  ?? '',
        isCommon:       !!e.c,
        senses: [
          {
            definitions:   e.m.split('; '),
            partsOfSpeech: e.p ? [e.p] : [],
          },
          ...(e.s ?? []).map(s => ({
            definitions:   s.m.split('; '),
            partsOfSpeech: s.p ? [s.p] : [],
          })),
        ],
        allForms: [{ word: e.w, reading: e.r }],
      }));
    } catch {
      return [];
    }
  }

  return { search, preload };
})();
