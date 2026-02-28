// app.js — Main application orchestration

// Config fallback — used when config.js isn't deployed (keys entered via Settings instead)
if (!window.Config) {
  window.Config = {
    get(key) {
      return localStorage.getItem(`yomu_cfg_${key}`) ?? window.YOMU_CONFIG?.[key] ?? null;
    },
    set(key, value) {
      if (value) localStorage.setItem(`yomu_cfg_${key}`, value);
      else localStorage.removeItem(`yomu_cfg_${key}`);
    },
  };
}

const App = (() => {

  // ---- State ----
  let currentAnnotations = [];
  let currentPhotoData   = null;
  let currentWord        = null;
  let currentContext     = null;
  let currentResult      = null;  // the selected Jisho candidate
  let currentCandidates  = [];    // all dict candidates for this tap
  let currentOriginal    = null;  // inflected form from OCR (e.g. 食べている)
  let currentDictionary  = null;  // dictionary form looked up (e.g. 食べる)
  let currentLayout      = null;  // detected page layout
  let currentMergeMap    = null;  // Map<idx, {groupId, combinedText}> from Enhance
  let enhanceMode        = false;
  let sheetOpen          = false;
  let sheetTouchStartY   = 0;
  let toastTimer         = null;

  // ---- DOM refs ----
  const els = {};
  function el(id) {
    if (!els[id]) els[id] = document.getElementById(id);
    return els[id];
  }

  // ---- Toast ----
  function showToast(msg, duration = 3000) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.remove('hidden', 'hiding');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.add('hiding');
      setTimeout(() => t.classList.add('hidden'), 320);
    }, duration);
  }

  // ---- Queue badge ----
  function updateQueueBadge() {
    const count = Anki.queueCount();
    const btn   = el('anki-queue-btn');
    const badge = el('queue-count');
    if (count > 0) {
      badge.textContent = count;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  // ---- Camera flow ----
  async function runCapture(photoData) {
    el('empty-state').classList.add('hidden');
    el('photo-view').classList.remove('hidden');
    el('processing-overlay').classList.remove('hidden');
    closeSheet();

    try {
      currentPhotoData = photoData;
      el('photo-img').src = currentPhotoData.dataUrl;
      el('tap-overlay').innerHTML = '';

      currentAnnotations = await Vision.detectText(currentPhotoData.base64);
      currentLayout      = Vision.detectLayout(currentAnnotations);
      currentMergeMap    = null;
      enhanceMode        = false;

      Vision.renderTapTargets(
        currentAnnotations,
        el('tap-overlay'),
        currentPhotoData.naturalWidth,
        currentPhotoData.naturalHeight,
        onWordTapped
      );

      el('processing-overlay').classList.add('hidden');
      el('enhance-btn').classList.remove('hidden');
      el('enhance-btn').textContent  = '✦ Enhance';
      el('enhance-btn').dataset.active = 'false';

    } catch (err) {
      el('processing-overlay').classList.add('hidden');
      showToast(`Error: ${err.message}`);
      console.error(err);
    }
  }

  // ---- Word tap → Jisho lookup ----
  async function onWordTapped(word, context) {
    currentWord       = word;
    currentContext    = context;
    currentResult     = null;
    currentCandidates = [];
    openSheetLoading();

    try {
      const { original, dictionary } = await Morphology.getDictionaryForm(word);
      currentOriginal   = original;
      currentDictionary = dictionary;

      const candidates = await Dict.search(dictionary);

      if (candidates.length === 0) {
        renderSheetResult({ word: dictionary, reading: '', primaryMeaning: '', primaryPos: '', isCommon: false }, [], false);
        return;
      }

      currentCandidates = candidates;
      await selectCandidate(candidates[0]);

    } catch (err) {
      renderSheetError(err.message);
    }
  }

  /**
   * Select a candidate (from Jisho results) and render the sheet.
   * Also checks Anki for this specific word form.
   */
  async function selectCandidate(candidate) {
    currentResult = candidate;
    currentWord   = candidate.word || candidate.reading;

    const ankiExists = await Anki.existsInDeck(currentWord);
    renderSheetResult(candidate, currentCandidates, ankiExists);
  }

  // ---- Bottom sheet ----
  function openSheetLoading() {
    el('sheet-loading').classList.remove('hidden');
    el('sheet-content').classList.add('hidden');
    el('sheet-error').classList.add('hidden');
    openSheet();
  }

  function openSheet() {
    if (sheetOpen) return;
    sheetOpen = true;
    el('sheet-backdrop').classList.remove('hidden');
    el('bottom-sheet').classList.remove('hidden');
    el('bottom-sheet').style.transform = '';
    requestAnimationFrame(() => {
      el('sheet-backdrop').classList.add('visible');
      el('bottom-sheet').classList.add('open');
    });
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    el('sheet-backdrop').classList.remove('visible');
    el('bottom-sheet').classList.remove('open');
    document.querySelectorAll('.tap-target.active').forEach(t => t.classList.remove('active'));
    setTimeout(() => {
      el('sheet-backdrop').classList.add('hidden');
      el('bottom-sheet').classList.add('hidden');
    }, 300);
  }

  function renderSheetResult(candidate, allCandidates, ankiExists) {
    el('sheet-loading').classList.add('hidden');
    el('sheet-error').classList.add('hidden');
    el('sheet-content').classList.remove('hidden');

    // Show inflected → dictionary form when they differ
    const inflectionEl = el('sheet-inflection');
    if (currentOriginal && currentDictionary && currentOriginal !== currentDictionary) {
      inflectionEl.textContent = `${currentOriginal} → ${currentDictionary}`;
      inflectionEl.classList.remove('hidden');
    } else {
      inflectionEl.classList.add('hidden');
    }

    // Word + reading
    el('sheet-word').textContent    = candidate.word || candidate.reading;
    el('sheet-reading').textContent = candidate.reading ?? '';
    el('sheet-meaning').textContent = candidate.primaryMeaning ?? '';
    el('sheet-pos').textContent     = candidate.primaryPos ?? '';

    // Candidate picker — only show if more than one result
    renderCandidatePicker(allCandidates, candidate);

    // Additional senses (beyond primary)
    renderExtraSenses(candidate.senses ?? []);

    // WaniKani badge
    renderWkBadge(WaniKani.lookup(currentWord));

    // Anki badge + buttons
    renderAnkiBadge(currentWord, ankiExists);

    // Hide component kanji section (future enhancement)
    el('sheet-components').classList.add('hidden');
    el('sheet-example').classList.add('hidden');
  }

  function renderCandidatePicker(candidates, selected) {
    const container = el('sheet-candidates');
    const list      = el('candidates-list');

    if (candidates.length <= 1) {
      container.classList.add('hidden');
      return;
    }

    list.innerHTML = candidates.map((c, i) => {
      const label    = c.word ? `${c.word}【${c.reading}】` : c.reading;
      const isActive = (c.word || c.reading) === (selected.word || selected.reading);
      return `<button class="candidate-chip${isActive ? ' active' : ''}" data-idx="${i}">${label}</button>`;
    }).join('');

    list.querySelectorAll('.candidate-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        selectCandidate(currentCandidates[idx]);
      });
    });

    container.classList.remove('hidden');
  }

  function renderExtraSenses(senses) {
    const container = el('sheet-extra-senses');
    if (!container) return;
    if (senses.length <= 1) { container.classList.add('hidden'); return; }

    container.innerHTML = senses.slice(1).map(s =>
      `<div class="extra-sense">${s.partsOfSpeech.join(', ')} — ${s.definitions.join('; ')}</div>`
    ).join('');
    container.classList.remove('hidden');
  }

  function renderWkBadge(wkStatus) {
    const badge = el('wk-badge');
    if (!wkStatus) { badge.className = 'badge'; badge.textContent = ''; return; }
    badge.className   = `badge badge-${wkStatus.badge}`;
    badge.textContent = wkStatus.label;
  }

  function renderAnkiBadge(word, ankiExists) {
    const badge     = el('anki-badge');
    const addBtn    = el('add-anki-btn');
    const queueBtn  = el('queue-anki-btn');
    const alreadyEl = el('already-in-anki');

    addBtn.classList.add('hidden');
    queueBtn.classList.add('hidden');
    alreadyEl.classList.add('hidden');
    badge.className   = 'badge';
    badge.textContent = '';

    if (ankiExists) {
      badge.className   = 'badge badge-anki-yes';
      badge.textContent = 'In Anki';
      alreadyEl.classList.remove('hidden');
      return;
    }

    if (Anki.isInQueue(word)) {
      badge.className   = 'badge badge-anki-queued';
      badge.textContent = 'Queued';
      return;
    }

    badge.className   = 'badge badge-anki-no';
    badge.textContent = 'Not in Anki';

    if (Anki.reachable) {
      addBtn.classList.remove('hidden');
    } else {
      queueBtn.classList.remove('hidden');
    }
  }

  function renderSheetError(msg) {
    el('sheet-loading').classList.add('hidden');
    el('sheet-content').classList.add('hidden');
    el('sheet-error').classList.remove('hidden');
    el('sheet-error-msg').textContent = msg;
  }

  // ---- Swipe-to-dismiss ----
  function initSheetSwipe() {
    const sheet      = el('bottom-sheet');
    const handleArea = el('sheet-handle-area');

    handleArea.addEventListener('touchstart', (e) => {
      sheetTouchStartY = e.touches[0].clientY;
    }, { passive: true });

    handleArea.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - sheetTouchStartY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });

    handleArea.addEventListener('touchend', (e) => {
      const dy = e.changedTouches[0].clientY - sheetTouchStartY;
      sheet.style.transform = '';
      if (dy > 80) closeSheet();
    });
  }

  // ---- Anki: generate sentences then add/queue ----

  async function getAnkiCardData() {
    const btn = el('add-anki-btn').textContent !== 'Add to Anki'
      ? el('queue-anki-btn') : el('add-anki-btn');

    const meaning = currentResult?.primaryMeaning ?? '';
    const reading = currentResult?.reading        ?? '';

    const sentences = await Claude.generateSentences(
      currentWord, reading, meaning, currentContext ?? ''
    );
    return { reading, ...sentences };
  }

  async function onAddToAnki() {
    if (!currentWord) return;
    const btn = el('add-anki-btn');
    btn.disabled    = true;
    btn.textContent = 'Generating…';
    try {
      const cardData = await getAnkiCardData();
      await Anki.addCard(currentWord, cardData);
      el('anki-badge').className   = 'badge badge-anki-yes';
      el('anki-badge').textContent = 'In Anki';
      btn.classList.add('hidden');
      el('already-in-anki').classList.remove('hidden');
      showToast(`Added「${currentWord}」to Anki`);
    } catch (err) {
      showToast(`Failed: ${err.message}`);
      btn.disabled    = false;
      btn.textContent = 'Add to Anki';
    }
  }

  async function onQueueForAnki() {
    if (!currentWord) return;
    const btn = el('queue-anki-btn');
    btn.disabled    = true;
    btn.textContent = 'Generating…';
    try {
      const cardData = await getAnkiCardData();
      Anki.queueCard(currentWord, cardData);
      el('anki-badge').className   = 'badge badge-anki-queued';
      el('anki-badge').textContent = 'Queued';
      btn.classList.add('hidden');
      updateQueueBadge();
      showToast(`Queued「${currentWord}」for Anki`);
    } catch (err) {
      showToast(`Failed: ${err.message}`);
      btn.disabled    = false;
      btn.textContent = 'Queue for Anki';
    }
  }

  async function onFlushQueue() {
    const count = await Anki.flushQueue();
    if (count > 0) {
      showToast(`${count} card${count > 1 ? 's' : ''} synced to Anki`);
    } else if (!Anki.reachable) {
      showToast('Anki not reachable — are you on home WiFi?');
    } else {
      showToast('Queue already empty');
    }
    updateQueueBadge();
  }

  // ---- Enhance (OCR segmentation fix) ----
  async function onEnhance() {
    if (!currentAnnotations.length) return;
    const btn = el('enhance-btn');

    // Toggle off if already enhanced
    if (enhanceMode) {
      enhanceMode     = false;
      currentMergeMap = null;
      btn.textContent        = '✦ Enhance';
      btn.dataset.active     = 'false';
      Vision.renderTapTargets(
        currentAnnotations, el('tap-overlay'),
        currentPhotoData.naturalWidth, currentPhotoData.naturalHeight,
        onWordTapped
      );
      return;
    }

    btn.textContent  = 'Enhancing…';
    btn.disabled     = true;

    try {
      const result = await Claude.fixSegmentation(currentAnnotations, currentLayout);

      // Build mergeMap from mergedGroups
      currentMergeMap = new Map();
      (result.mergedGroups ?? []).forEach((group, groupId) => {
        const combinedText = group.map(i => {
          const corrected = result.correctedText?.[String(i)];
          return corrected ?? currentAnnotations[i]?.description ?? '';
        }).join('');

        group.forEach(i => {
          currentMergeMap.set(i, { groupId, combinedText });
        });
      });

      // Apply correctedText to non-merged tokens too
      if (result.correctedText) {
        Object.entries(result.correctedText).forEach(([idxStr, text]) => {
          const i = parseInt(idxStr, 10);
          if (!currentMergeMap.has(i) && currentAnnotations[i]) {
            currentAnnotations[i] = { ...currentAnnotations[i], description: text };
          }
        });
      }

      enhanceMode           = true;
      btn.textContent       = '✦ Enhanced';
      btn.dataset.active    = 'true';
      btn.disabled          = false;

      Vision.renderTapTargets(
        currentAnnotations, el('tap-overlay'),
        currentPhotoData.naturalWidth, currentPhotoData.naturalHeight,
        onWordTapped, currentMergeMap
      );

      const groupCount = result.mergedGroups?.length ?? 0;
      showToast(groupCount > 0
        ? `${groupCount} word group${groupCount > 1 ? 's' : ''} merged`
        : 'No segmentation errors found'
      );

    } catch (err) {
      showToast(`Enhance failed: ${err.message}`);
      btn.textContent = '✦ Enhance';
      btn.disabled    = false;
    }
  }

  // ---- Settings ----
  function openSettings() {
    el('cfg-vision-key').value = Config.get('GOOGLE_VISION_API_KEY') ?? '';
    el('cfg-claude-key').value = Config.get('ANTHROPIC_API_KEY')     ?? '';
    el('cfg-wk-token').value   = Config.get('WANIKANI_API_TOKEN')     ?? '';
    el('cfg-wk-level').value   = Config.get('WANIKANI_LEVEL')         ?? '24';
    el('settings-status').textContent = '';
    el('settings-panel').classList.remove('hidden');
  }

  function closeSettings() {
    el('settings-panel').classList.add('hidden');
  }

  function saveSettings() {
    Config.set('GOOGLE_VISION_API_KEY', el('cfg-vision-key').value.trim());
    Config.set('ANTHROPIC_API_KEY',     el('cfg-claude-key').value.trim());
    Config.set('WANIKANI_API_TOKEN',    el('cfg-wk-token').value.trim());
    Config.set('WANIKANI_LEVEL',        el('cfg-wk-level').value.trim());
    el('settings-status').textContent = 'Saved!';
    setTimeout(() => closeSettings(), 800);
    WaniKani.refresh();
  }

  // ---- Init ----
  function init() {
    Camera.init({ onCapture: runCapture });

    el('camera-btn').addEventListener('click', () => Camera.open());
    el('enhance-btn').addEventListener('click', onEnhance);
    el('sheet-backdrop').addEventListener('click', closeSheet);
    el('settings-btn').addEventListener('click', openSettings);
    el('settings-close-btn').addEventListener('click', closeSettings);
    el('settings-save-btn').addEventListener('click', saveSettings);
    el('add-anki-btn').addEventListener('click', onAddToAnki);
    el('queue-anki-btn').addEventListener('click', onQueueForAnki);
    el('anki-queue-btn').addEventListener('click', onFlushQueue);
    el('sheet-retry-btn').addEventListener('click', () => {
      if (currentWord) onWordTapped(currentWord, currentContext);
    });
    initSheetSwipe();

    Dict.preload();       // start loading dict in background
    Morphology.preload(); // start loading kuromoji dict in background
    WaniKani.init();
    Anki.init().then(updateQueueBadge);

    // iOS blocks camera without a user gesture, so make the empty state tappable
    el('empty-state').addEventListener('click', () => Camera.open());
    updateQueueBadge();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(e => {
        console.warn('SW registration failed:', e);
      });
    }
  }

  window.App = { showToast };
  document.addEventListener('DOMContentLoaded', init);
  return { showToast };
})();
