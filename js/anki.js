// anki.js — AnkiConnect integration + offline queue

const Anki = (() => {
  const ANKI_URL  = 'http://localhost:8765';
  const DECK_NAME = 'ALL KANJI COMBINED';
  const MODEL_NAME = 'Japanese Vocab';
  const QUEUE_KEY  = 'yomu_anki_queue';
  const TIMEOUT_MS = 3000;

  let isReachable = false;

  // ---- Internal helpers ----

  async function ankiRequest(action, params = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ANKI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: 6, params }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.result;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  function buildNote(word, result) {
    return {
      deckName:  DECK_NAME,
      modelName: MODEL_NAME,
      fields: {
        Front:     word,
        Reading:   result.reading   ?? '',
        Sentence1: result.anki_sentence_1 ?? '',
        Sentence2: result.anki_sentence_2 ?? '',
      },
      options: { allowDuplicate: false },
      tags: ['yomu'],
    };
  }

  // ---- Queue management ----

  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    } catch { return []; }
  }

  function saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function queueCount() {
    return loadQueue().length;
  }

  function addToQueue(word, result) {
    const queue = loadQueue();
    // Avoid duplicates
    if (queue.some(item => item.word === word)) return;
    queue.push({ word, result, timestamp: Date.now() });
    saveQueue(queue);
  }

  function removeFromQueue(word) {
    const queue = loadQueue().filter(item => item.word !== word);
    saveQueue(queue);
  }

  function isInQueue(word) {
    return loadQueue().some(item => item.word === word);
  }

  // ---- Public API ----

  /** Ping AnkiConnect. Returns true if reachable. */
  async function ping() {
    try {
      await ankiRequest('version');
      isReachable = true;
    } catch {
      isReachable = false;
    }
    return isReachable;
  }

  /**
   * Check if a word already exists in the Anki deck.
   * @returns {Promise<boolean>}
   */
  async function existsInDeck(word) {
    if (!isReachable) return false;
    try {
      const noteIds = await ankiRequest('findNotes', {
        query: `deck:"${DECK_NAME}" front:"${word}"`,
      });
      return noteIds.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Add a card immediately via AnkiConnect.
   * @returns {Promise<number>} the new note ID
   */
  async function addCard(word, result) {
    return ankiRequest('addNote', { note: buildNote(word, result) });
  }

  /**
   * Queue a card for later sync.
   */
  function queueCard(word, result) {
    addToQueue(word, result);
  }

  /**
   * Attempt to flush all queued cards to Anki.
   * @returns {Promise<number>} number of cards successfully synced
   */
  async function flushQueue() {
    if (!isReachable) return 0;
    const queue = loadQueue();
    if (queue.length === 0) return 0;

    let synced = 0;
    for (const item of queue) {
      try {
        await addCard(item.word, item.result);
        removeFromQueue(item.word);
        synced++;
      } catch (e) {
        // Note may already exist or other error — skip
        if (e.message?.includes('duplicate')) {
          removeFromQueue(item.word);
        }
        console.warn(`Anki queue flush: failed for "${item.word}"`, e.message);
      }
    }
    return synced;
  }

  /**
   * Initialize: ping AnkiConnect and try to flush queue.
   * @returns {Promise<void>}
   */
  async function init() {
    await ping();
    if (isReachable) {
      const count = await flushQueue();
      if (count > 0) {
        App.showToast(`${count} card${count > 1 ? 's' : ''} synced to Anki`);
      }
    }
  }

  return {
    init,
    ping,
    existsInDeck,
    addCard,
    queueCard,
    flushQueue,
    queueCount,
    isInQueue,
    get reachable() { return isReachable; },
  };
})();
