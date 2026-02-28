// morphology.js — kuromoji wrapper for Japanese morphological analysis
// De-inflects words to their dictionary form (基本形) before JMdict lookup.

const Morphology = (() => {
  const DICT_PATH = 'dict/kuromoji';

  let tokenizer = null;
  let promise   = null;

  /**
   * Load kuromoji tokenizer (once). Subsequent calls return cached instance.
   */
  function load() {
    if (tokenizer) return Promise.resolve(tokenizer);
    if (promise)   return promise;

    promise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: DICT_PATH }).build((err, built) => {
        if (err) { promise = null; reject(err); return; }
        tokenizer = built;
        promise   = null;
        resolve(tokenizer);
      });
    });

    return promise;
  }

  /**
   * Preload in background so it's ready when the user first taps.
   */
  function preload() {
    load().catch(() => {});
  }

  /**
   * Get the dictionary form of a word.
   * Returns { original, dictionary } where dictionary is the 基本形.
   * If kuromoji fails or the form is unchanged, dictionary === original.
   *
   * @param {string} word - surface form from OCR (e.g. 食べている)
   * @returns {Promise<{ original: string, dictionary: string }>}
   */
  async function getDictionaryForm(word) {
    const original = word;
    try {
      const t      = await load();
      const tokens = t.tokenize(word);
      if (!tokens || tokens.length === 0) return { original, dictionary: original };

      // For a single tapped token, reconstruct the dictionary form from the
      // first content token (skip particles/auxiliaries at the end).
      // The simplest useful heuristic: take the basic_form of the first token
      // that has a real basic_form (not '*').
      const contentToken = tokens.find(tok =>
        tok.basic_form && tok.basic_form !== '*' && tok.pos !== '助詞' && tok.pos !== '記号'
      ) ?? tokens[0];

      const dictionary = (contentToken?.basic_form && contentToken.basic_form !== '*')
        ? contentToken.basic_form
        : original;

      return { original, dictionary };
    } catch {
      return { original, dictionary: original };
    }
  }

  return { preload, getDictionaryForm };
})();
