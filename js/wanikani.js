// wanikani.js — WaniKani API integration with daily cache

const WaniKani = (() => {
  const CACHE_KEY = 'yomu_wk_cache';
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  const BASE_URL  = 'https://api.wanikani.com/v2';

  // SRS stage → display info mapping
  const SRS_STAGES = {
    1: { label: 'Apprentice I',   badge: 'apprentice' },
    2: { label: 'Apprentice II',  badge: 'apprentice' },
    3: { label: 'Apprentice III', badge: 'apprentice' },
    4: { label: 'Apprentice IV',  badge: 'apprentice' },
    5: { label: 'Guru I',         badge: 'guru' },
    6: { label: 'Guru II',        badge: 'guru' },
    7: { label: 'Master',         badge: 'master' },
    8: { label: 'Enlightened',    badge: 'enlightened' },
    9: { label: 'Burned',         badge: 'burned' },
  };

  let cache = null; // { timestamp, subjects: Map<chars, {id, level, type}>, assignments: Map<subjectId, srsStage> }

  /** Load cache from localStorage */
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Convert plain objects back to Maps
      parsed.subjects    = new Map(Object.entries(parsed.subjects));
      parsed.assignments = new Map(Object.entries(parsed.assignments).map(([k, v]) => [Number(k), v]));
      return parsed;
    } catch {
      return null;
    }
  }

  /** Persist cache to localStorage */
  function saveCache(data) {
    try {
      const serializable = {
        timestamp:   data.timestamp,
        subjects:    Object.fromEntries(data.subjects),
        assignments: Object.fromEntries(data.assignments),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.warn('WaniKani: failed to save cache', e);
    }
  }

  /**
   * Fetch all pages from a WaniKani collection endpoint.
   * @param {string} url - starting URL
   * @param {string} token - API token
   * @returns {Promise<Array>} all data items across pages
   */
  async function fetchAllPages(url, token) {
    const items = [];
    let nextUrl = url;
    while (nextUrl) {
      const res = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Wanikani-Revision': '20170710',
        },
      });
      if (!res.ok) throw new Error(`WaniKani API error ${res.status}`);
      const data = await res.json();
      items.push(...(data.data ?? []));
      nextUrl = data.pages?.next_url ?? null;
    }
    return items;
  }

  /**
   * Fetch and cache all WaniKani subjects and assignments.
   * Runs in background — won't block UI.
   */
  async function fetchAndCache() {
    const token = Config.get('WANIKANI_API_TOKEN');
    if (!token) return;

    try {
      console.log('WaniKani: fetching data…');

      // Fetch kanji and vocabulary subjects
      const [kanjiItems, vocabItems] = await Promise.all([
        fetchAllPages(`${BASE_URL}/subjects?types=kanji&hidden=false`, token),
        fetchAllPages(`${BASE_URL}/subjects?types=vocabulary&hidden=false`, token),
      ]);

      const subjects = new Map();
      for (const item of [...kanjiItems, ...vocabItems]) {
        const chars = item.data?.characters;
        if (chars) {
          subjects.set(chars, {
            id:    item.id,
            level: item.data.level,
            type:  item.object, // 'kanji' or 'vocabulary'
          });
        }
      }

      // Fetch all assignments
      const assignmentItems = await fetchAllPages(`${BASE_URL}/assignments?subject_types=kanji,vocabulary`, token);
      const assignments = new Map();
      for (const item of assignmentItems) {
        assignments.set(item.data.subject_id, item.data.srs_stage);
      }

      cache = { timestamp: Date.now(), subjects, assignments };
      saveCache(cache);
      console.log(`WaniKani: cached ${subjects.size} subjects, ${assignments.size} assignments`);
    } catch (e) {
      console.warn('WaniKani: fetch failed', e.message);
    }
  }

  /**
   * Initialize: load cache from storage, kick off refresh if stale.
   */
  function init() {
    cache = loadCache();
    const age = cache ? Date.now() - cache.timestamp : Infinity;
    if (age > CACHE_TTL) {
      fetchAndCache(); // background refresh
    }
  }

  /**
   * Look up SRS status for a word.
   * @param {string} word
   * @returns {{ label: string, badge: string } | null}
   *   badge ∈ 'apprentice'|'guru'|'master'|'enlightened'|'burned'|'locked'|'not-wk'
   */
  function lookup(word) {
    if (!cache) return null;

    const subject = cache.subjects.get(word);
    if (!subject) return { label: 'Not in WaniKani', badge: 'not-wk' };

    const srsStage = cache.assignments.get(subject.id);
    if (srsStage === undefined) {
      return { label: 'Locked', badge: 'locked' };
    }

    return SRS_STAGES[srsStage] ?? { label: 'Unknown', badge: 'locked' };
  }

  /**
   * Force a fresh fetch, e.g. after user sets API token in Settings.
   */
  function refresh() {
    cache = null;
    fetchAndCache();
  }

  return { init, lookup, refresh };
})();
