// vision.js — Google Cloud Vision API + tap target rendering

const Vision = (() => {
  // ---- Text detection ----

  async function detectText(base64Image) {
    const result = await API.request("vision", { image: base64Image });

    const annotations = result?.textAnnotations;
    if (!annotations || annotations.length < 2)
      throw new Error("No text detected in image.");

    const paragraphs = (result.fullTextAnnotation?.pages || []).flatMap(
      (page) => (page.blocks || []).flatMap((block) => block.paragraphs || []),
    );
    const bubbles = paragraphs
      .map((paragraph) => ({
        description: (paragraph.words || [])
          .map((word) => (word.symbols || []).map((s) => s.text).join(""))
          .join(""),
        boundingPoly: paragraph.boundingBox,
      }))
      .filter((b) => b.description && b.boundingPoly);
    // Japanese OCR often emits one box per character. Segment full paragraphs so
    // compounds like 勉強 remain one tappable word, then union their symbol boxes.
    const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
    const words = [];
    for (const paragraph of paragraphs) {
      const symbols = (paragraph.words || []).flatMap((w) => w.symbols || []);
      const text = symbols.map((s) => s.text).join("");
      if (!symbols.every((s) => s.boundingBox?.vertices)) continue;
      for (const part of segmenter.segment(text)) {
        if (!part.isWordLike) continue;
        let offset = 0;
        const points = [];
        for (const symbol of symbols) {
          const end = offset + symbol.text.length;
          if (end > part.index && offset < part.index + part.segment.length)
            points.push(...symbol.boundingBox.vertices);
          offset = end;
        }
        if (!points.length) continue;
        const xs = points.map((p) => p.x || 0),
          ys = points.map((p) => p.y || 0);
        const left = Math.min(...xs),
          right = Math.max(...xs),
          top = Math.min(...ys),
          bottom = Math.max(...ys);
        words.push({
          description: part.segment,
          boundingPoly: {
            vertices: [
              { x: left, y: top },
              { x: right, y: top },
              { x: right, y: bottom },
              { x: left, y: bottom },
            ],
          },
        });
      }
    }
    return {
      annotations: words.length ? words : annotations.slice(1),
      fullText: result.fullTextAnnotation?.text || annotations[0].description,
      bubbles,
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
  function renderTapTargets(
    annotations,
    overlayEl,
    imgW,
    imgH,
    onTap,
    mergeMap = null,
  ) {
    overlayEl.innerHTML = "";

    annotations.forEach((annotation, idx) => {
      const vertices = annotation.boundingPoly?.vertices;
      if (!vertices || vertices.length < 3) return;

      const xs = vertices.map((v) => v.x ?? 0);
      const ys = vertices.map((v) => v.y ?? 0);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const w = maxX - minX;
      const h = maxY - minY;

      if (w <= 0 || h <= 0) return;

      const target = document.createElement("button");
      target.style.left = `${(minX / imgW) * 100}%`;
      target.style.top = `${(minY / imgH) * 100}%`;
      target.style.width = `${(w / imgW) * 100}%`;
      target.style.height = `${(h / imgH) * 100}%`;
      target.dataset.idx = idx;
      target.type = "button";
      target.setAttribute("aria-label", annotation.description);

      const mergeInfo = mergeMap?.get(idx);
      if (mergeInfo) {
        // Part of a merged group — shared visual style per group
        target.className = `tap-target tap-target--merged group-color-${mergeInfo.groupId % 6}`;
        target.dataset.word = mergeInfo.combinedText;
        target.dataset.groupId = mergeInfo.groupId;
      } else {
        target.className = "tap-target";
        target.dataset.word = annotation.description;
      }

      target.addEventListener("click", (e) => {
        e.stopPropagation();
        document
          .querySelectorAll(".tap-target.active")
          .forEach((t) => t.classList.remove("active"));

        // If merged, highlight all boxes in the same group
        if (mergeInfo) {
          overlayEl
            .querySelectorAll(`[data-group-id="${mergeInfo.groupId}"]`)
            .forEach((t) => t.classList.add("active"));
        } else {
          target.classList.add("active");
        }

        const word = target.dataset.word;
        const context = getContext(annotations, idx, 20);
        onTap(word, context, idx);
      });

      overlayEl.appendChild(target);
    });
  }

  function getContext(annotations, centerIdx, windowSize) {
    const start = Math.max(0, centerIdx - windowSize);
    const end = Math.min(annotations.length - 1, centerIdx + windowSize);
    return annotations
      .slice(start, end + 1)
      .map((a) => a.description)
      .join("");
  }

  return { detectText, renderTapTargets };
})();
