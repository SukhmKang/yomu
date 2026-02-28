// claude.js — Anthropic Claude API, used only for Anki sentence generation

const Claude = (() => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const MODEL    = 'claude-sonnet-4-20250514';

  const SYSTEM_PROMPT = `You generate example sentences for Japanese Anki flashcards. The learner knows approximately 600-700 kanji (WaniKani level 24) and is targeting JLPT N2.

Respond ONLY with a valid JSON object — no markdown, no explanation, just raw JSON:
{
  "anki_sentence_1": "sentence with Anki ruby furigana on kanji only",
  "anki_sentence_2": "second sentence in a different context, also with Anki ruby furigana"
}

Sentence requirements:
- BOTH sentences MUST contain the target vocabulary word — this is non-negotiable
- N2 level: natural, native-sounding Japanese as found in novels or manga; not textbook Japanese
- Grammar and vocabulary complexity appropriate for N2 (e.g. ～ても、～ながら、～ように、conditionals, passive/causative)
- The two sentences must use the word in meaningfully different contexts or grammatical roles
- Prefer sentences that make the word's meaning clearly inferable from context

Anki ruby furigana rules:
- Add furigana ONLY to kanji characters, not kana or okurigana
- Format: 漢字[よみかた] immediately after the kanji
- Correct: 毎日[まいにち]勉強[べんきょう]する
- Wrong: 毎[まい]日[にち]すること (okurigana split incorrectly)`;

  /**
   * Generate two Anki example sentences for a word.
   * Called only when the user adds a card — not on every lookup.
   *
   * @param {string} word    - kanji form (e.g. 夜)
   * @param {string} reading - hiragana reading (e.g. よる)
   * @param {string} meaning - English meaning (e.g. "night, evening")
   * @param {string} context - surrounding text from the photographed page
   * @returns {Promise<{ anki_sentence_1: string, anki_sentence_2: string }>}
   */
  async function generateSentences(word, reading, meaning, context = '') {
    const apiKey = Config.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Anthropic API key not configured. Open Settings to add it.');

    let userMessage = `Target word: ${word} (${reading}) — ${meaning}\n\nBoth sentences MUST use 「${word}」.`;
    if (context) userMessage += `\n\nContext from the page (for reference only — do not copy directly):\n${context}`;
    userMessage += '\n\nGenerate two N2-level example sentences.';

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${response.status}`);
    }

    const data    = await response.json();
    const rawText = data.content?.[0]?.text ?? '';

    try {
      return JSON.parse(rawText.trim());
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Claude returned an unexpected response format.');
    }
  }

  // ---- Segmentation fix ----

  const SEG_SYSTEM = `You are a Japanese OCR correction assistant. You will receive a numbered list of tokens detected by Google Vision OCR, along with the page layout direction. Your job is to identify tokens that should be merged into single words due to incorrect OCR segmentation.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "mergedGroups": [[0,1], [5,6,7]],
  "correctedText": { "3": "正しい文字" }
}

Rules:
- mergedGroups: arrays of token indices that belong to a single word. Only include groups of 2 or more.
- correctedText: map of index → corrected string for obvious misreads. Omit if none.
- Do NOT merge tokens that are already correct individual words.
- Consider the layout direction when deciding if adjacent tokens cross a line/column boundary.
- If no corrections are needed, return { "mergedGroups": [], "correctedText": {} }`;

  /**
   * Ask Claude to fix OCR segmentation errors.
   * @param {Array}  annotations - Vision API word annotations
   * @param {string} layout      - 'vertical_columns_rtl' | 'horizontal_rows_ltr'
   * @returns {Promise<{ mergedGroups: number[][], correctedText: Object }>}
   */
  async function fixSegmentation(annotations, layout) {
    const apiKey = Config.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Anthropic API key not configured. Open Settings to add it.');

    const layoutDesc = layout === 'vertical_columns_rtl'
      ? 'vertical columns reading right to left (tategumi)'
      : 'horizontal rows reading left to right (yokogumi)';

    const tokenList = annotations
      .map((a, i) => `${i}: "${a.description}"`)
      .join('\n');

    const userMessage =
      `Page layout: ${layoutDesc}\n\nOCR tokens:\n${tokenList}\n\nIdentify any tokens that should be merged.`;

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SEG_SYSTEM,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Claude API error ${response.status}`);
    }

    const data    = await response.json();
    const rawText = data.content?.[0]?.text ?? '';

    try {
      return JSON.parse(rawText.trim());
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('Claude returned an unexpected response format.');
    }
  }

  return { generateSentences, fixSegmentation };
})();
