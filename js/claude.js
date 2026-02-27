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

  return { generateSentences };
})();
