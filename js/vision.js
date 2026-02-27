// vision.js — Google Cloud Vision API + tap target rendering

const Vision = (() => {
  const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

  // Minimum area (in % of image area) for a tap target — filters out noise
  const MIN_AREA_PERCENT = 0.0001;

  /**
   * Send base64 image to Vision API, return structured word annotations.
   * @param {string} base64Image - base64 encoded image (without data URI prefix)
   * @returns {Promise<Array>} array of annotation objects
   */
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

    const data = await response.json();
    const result = data.responses?.[0];

    if (result?.error) throw new Error(result.error.message);

    const annotations = result?.textAnnotations;
    if (!annotations || annotations.length < 2) {
      throw new Error('No text detected in image.');
    }

    // annotations[0] is the full text block — skip it, return word-level annotations
    return annotations.slice(1);
  }

  /**
   * Render semi-transparent tap targets over the photo.
   * Uses percentage-based positioning so they scale with the image.
   * @param {Array} annotations - word annotations from Vision API
   * @param {HTMLElement} overlayEl - the overlay div
   * @param {number} imgNaturalWidth - original image width in pixels
   * @param {number} imgNaturalHeight - original image height in pixels
   * @param {function} onTap - called with (word, contextWords, annotationIndex)
   */
  function renderTapTargets(annotations, overlayEl, imgNaturalWidth, imgNaturalHeight, onTap) {
    overlayEl.innerHTML = '';

    const imageArea = imgNaturalWidth * imgNaturalHeight;

    annotations.forEach((annotation, idx) => {
      const vertices = annotation.boundingPoly?.vertices;
      if (!vertices || vertices.length < 3) return;

      // Compute bounding rect from polygon vertices
      const xs = vertices.map(v => v.x ?? 0);
      const ys = vertices.map(v => v.y ?? 0);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const w = maxX - minX;
      const h = maxY - minY;

      // Filter out degenerate boxes
      const area = w * h;
      if (area / imageArea < MIN_AREA_PERCENT) return;

      const target = document.createElement('div');
      target.className = 'tap-target';
      target.style.left   = `${(minX / imgNaturalWidth)  * 100}%`;
      target.style.top    = `${(minY / imgNaturalHeight) * 100}%`;
      target.style.width  = `${(w    / imgNaturalWidth)  * 100}%`;
      target.style.height = `${(h    / imgNaturalHeight) * 100}%`;
      target.dataset.word = annotation.description;
      target.dataset.idx  = idx;

      target.addEventListener('click', (e) => {
        e.stopPropagation();
        // Brief visual feedback
        document.querySelectorAll('.tap-target.active').forEach(t => t.classList.remove('active'));
        target.classList.add('active');

        // Gather surrounding context (nearby words in annotation list)
        const contextWords = getContext(annotations, idx, 20);
        onTap(annotation.description, contextWords, idx);
      });

      overlayEl.appendChild(target);
    });
  }

  /**
   * Extract a window of words around the tapped index for context.
   */
  function getContext(annotations, centerIdx, windowSize) {
    const start = Math.max(0, centerIdx - windowSize);
    const end   = Math.min(annotations.length - 1, centerIdx + windowSize);
    return annotations
      .slice(start, end + 1)
      .map(a => a.description)
      .join('');
  }

  return { detectText, renderTapTargets };
})();
