// vision.js — Google Cloud Vision API + tap target rendering

const Vision = (() => {
  const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
  const MIN_AREA_PERCENT = 0.0001;

  // ---- Text detection ----

  async function detectText(base64Image) {
    const apiKey = Config.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) throw new Error('Google Vision API key not configured. Open Settings to add it.');

    const response = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64Image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Vision API error ${response.status}`);
    }

    const data   = await response.json();
    const result = data.responses?.[0];
    if (result?.error) throw new Error(result.error.message);

    const annotations = result?.textAnnotations;
    if (!annotations || annotations.length < 2) throw new Error('No text detected in image.');

    return annotations.slice(1);
  }

  // ---- Layout detection ----

  /**
   * Analyse bounding box positions to determine if text flows vertically or horizontally.
   * Looks at consecutive token movements: more vertical movement → vertical columns.
   * @param {Array} annotations
   * @returns {'vertical_columns_rtl' | 'horizontal_rows_ltr'}
   */
  function detectLayout(annotations) {
    if (annotations.length < 5) return 'horizontal_rows_ltr';

    let verticalMoves = 0;
    let horizontalMoves = 0;

    for (let i = 0; i < annotations.length - 1; i++) {
      const a = getCenter(annotations[i]);
      const b = getCenter(annotations[i + 1]);
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dy > dx) verticalMoves++;
      else horizontalMoves++;
    }

    return verticalMoves > horizontalMoves ? 'vertical_columns_rtl' : 'horizontal_rows_ltr';
  }

  function getCenter(annotation) {
    const v  = annotation.boundingPoly?.vertices ?? [];
    const xs = v.map(p => p.x ?? 0);
    const ys = v.map(p => p.y ?? 0);
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
  }

  // ---- Tap target rendering ----

  /**
   * Render tap targets over the photo.
   * @param {Array}       annotations    - Vision API word annotations
   * @param {HTMLElement} overlayEl      - overlay container div
   * @param {number}      imgW / imgH    - original image dimensions
   * @param {function}    onTap          - (word, context, idx) callback
   * @param {Map}         mergeMap       - optional Map<idx, {groupId, combinedText}>
   *                                       built by the Enhance feature
   */
  function renderTapTargets(annotations, overlayEl, imgW, imgH, onTap, mergeMap = null) {
    overlayEl.innerHTML = '';
    const imageArea = imgW * imgH;

    annotations.forEach((annotation, idx) => {
      const vertices = annotation.boundingPoly?.vertices;
      if (!vertices || vertices.length < 3) return;

      const xs   = vertices.map(v => v.x ?? 0);
      const ys   = vertices.map(v => v.y ?? 0);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const w    = maxX - minX;
      const h    = maxY - minY;

      if ((w * h) / imageArea < MIN_AREA_PERCENT) return;

      const target = document.createElement('div');
      target.style.left   = `${(minX / imgW) * 100}%`;
      target.style.top    = `${(minY / imgH) * 100}%`;
      target.style.width  = `${(w    / imgW) * 100}%`;
      target.style.height = `${(h    / imgH) * 100}%`;
      target.dataset.idx  = idx;

      const mergeInfo = mergeMap?.get(idx);
      if (mergeInfo) {
        // Part of a merged group — shared visual style per group
        target.className       = `tap-target tap-target--merged group-color-${mergeInfo.groupId % 6}`;
        target.dataset.word    = mergeInfo.combinedText;
        target.dataset.groupId = mergeInfo.groupId;
      } else {
        target.className    = 'tap-target';
        target.dataset.word = annotation.description;
      }

      target.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tap-target.active').forEach(t => t.classList.remove('active'));

        // If merged, highlight all boxes in the same group
        if (mergeInfo) {
          overlayEl.querySelectorAll(`[data-group-id="${mergeInfo.groupId}"]`)
            .forEach(t => t.classList.add('active'));
        } else {
          target.classList.add('active');
        }

        const word    = target.dataset.word;
        const context = getContext(annotations, idx, 20);
        onTap(word, context, idx);
      });

      overlayEl.appendChild(target);
    });
  }

  function getContext(annotations, centerIdx, windowSize) {
    const start = Math.max(0, centerIdx - windowSize);
    const end   = Math.min(annotations.length - 1, centerIdx + windowSize);
    return annotations.slice(start, end + 1).map(a => a.description).join('');
  }

  return { detectText, detectLayout, renderTapTargets };
})();
