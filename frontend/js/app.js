const App = (() => {
  const $ = (id) => document.getElementById(id);
  let photo = null,
    annotations = [],
    bubbles = [],
    fullText = "",
    selected = new Set(),
    mode = "bubble";
  let pageVersion = 0,
    explanationVersion = 0,
    lookupVersion = 0,
    toastTimer;
  const explanationCache = new Map();
  const emptyExplanation = $("explanation").innerHTML;
  let zoom = 1, multiSelect = false, unlocked = false;
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  function showToast(message) {
    $("toast").textContent = message;
    $("toast").classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 4500);
  }
  function invalidateExplanation() {
    updateJump();
    explanationVersion++;
    $("explain-btn").disabled = false;
    $("explain-btn").textContent = "Explain";
    $("explanation").innerHTML = emptyExplanation;
  }
  function resetPage() {
    zoom = 1;
    $("photo-container").style.width = "100%";
    $("zoom-label").textContent = "100%";
    $("photo-zoom").classList.add("hidden");
    $("selection-jump").classList.add("hidden");
    pageVersion++;
    lookupVersion++;
    invalidateExplanation();
    selected.clear();
    annotations = [];
    bubbles = [];
    fullText = "";
    photo = null;
    mode = "bubble";
    multiSelect = false;
    $("multi-select").setAttribute("aria-pressed", "false");
    $("tap-overlay").classList.remove("multi-select");
    $("selected-text").textContent = "";
    updateJump();
    $("tap-overlay").replaceChildren();
    $("text-page").replaceChildren();
    $("photo-container").classList.add("hidden");
    $("retry-ocr").classList.add("hidden");
    $("scan-state").classList.add("hidden");
    $("welcome").classList.add("hidden");
    $("reader").classList.remove("hidden");
    $("word-dialog").close();
    window.scrollTo({ top: 0 });
  }
  function updateSelection() {
    $("selected-text").textContent = [...selected]
      .sort((a, b) => a - b)
      .map((i) => bubbles[i]?.description || "")
      .join("\n");
    invalidateExplanation();
    document
      .querySelectorAll("[data-bubble]")
      .forEach((el) =>
        el.classList.toggle("active", selected.has(Number(el.dataset.bubble))),
      );
  }
  function selectBubble(index) {
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    updateSelection();
  }
  function renderPage() {
    $("bubble-mode").setAttribute("aria-pressed", mode === "bubble");
    $("word-mode").setAttribute("aria-pressed", mode === "word");
    $("text-page").classList.toggle("hidden", !!photo);
    if (photo) {
      const items = mode === "bubble" ? bubbles : annotations;
      Vision.renderTapTargets(
        items,
        $("tap-overlay"),
        photo.naturalWidth,
        photo.naturalHeight,
        (word, context, index) => {
          if (mode === "bubble") selectBubble(index);
          else lookup(word);
        },
      );
      if (mode === "bubble")
        $("tap-overlay")
          .querySelectorAll(".tap-target")
          .forEach((el) => {
            el.dataset.bubble = el.dataset.idx;
            el.classList.toggle("active", selected.has(Number(el.dataset.idx)));
          });
    } else {
      $("text-page").replaceChildren();
      bubbles.forEach((bubble, index) => {
        if (mode === "bubble") {
          const button = document.createElement("button");
          button.className = "passage";
          button.textContent = bubble.description;
          button.dataset.bubble = index;
          button.classList.toggle("active", selected.has(index));
          button.onclick = () => selectBubble(index);
          $("text-page").append(button);
        } else {
          const p = document.createElement("p");
          for (const part of segmenter.segment(bubble.description)) {
            const token = document.createElement(
              part.isWordLike ? "button" : "span",
            );
            token.textContent = part.segment;
            if (part.isWordLike) {
              token.className = "word-token";
              token.onclick = () => lookup(part.segment);
            }
            p.append(token);
          }
          $("text-page").append(p);
        }
      });
    }
  }
  async function scan() {
    const version = pageVersion;
    $("scan-state").textContent = "Finding the text on your page…";
    $("scan-state").classList.remove("hidden", "error");
    $("retry-ocr").classList.add("hidden");
    try {
      const result = await Vision.detectText(photo.base64);
      if (version !== pageVersion) return;
      annotations = result.annotations;
      fullText = result.fullText;
      // Vision paragraphs are editable text-region candidates, not guaranteed manga bubble boundaries.
      bubbles = result.bubbles.length ? result.bubbles : annotations;
      $("page-status").textContent =
        `${bubbles.length} regions`;
      $("scan-state").classList.add("hidden");
      renderPage();
      saveSession();
    } catch (err) {
      if (version !== pageVersion) return;
      $("scan-state").textContent =
        err.message;
      $("scan-state").classList.add("error");
      $("retry-ocr").classList.remove("hidden");
      $("page-status").textContent = "Scan needs attention";
    }
  }
  async function importPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetPage();
    const version = pageVersion;
    $("page-status").textContent = "Opening photo…";
    try {
      const result = await Camera.processFile(file);
      if (version !== pageVersion) return;
      photo = result;
      $("photo-zoom").classList.remove("hidden");
      $("photo-img").src = result.dataUrl;
      $("photo-container").classList.remove("hidden");
      renderPage();
      await scan();
    } catch (err) {
      if (version === pageVersion) {
        showToast(err.message);
        $("page-status").textContent = "Could not open photo";
      }
    }
  }
  function section(title, text, lang) {
    const div = document.createElement("section");
    div.className = "explanation-section";
    if (lang) div.lang = lang;
    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = text;
    div.append(h, p);
    return div;
  }
  function renderExplanation(result) {
    $("explanation").replaceChildren(section("やさしく説明", result.simpleJapanese, "ja"));
  }
  async function explain() {
    const text = $("selected-text").textContent.trim();
    if (!text) return showToast("Select a bubble first.");
    const level = $("learner-level").value,
      context = fullText.slice(0, 6000),
      key = JSON.stringify([text, context, level]);
    const version = ++explanationVersion;
    $("explain-btn").disabled = true;
    $("explain-btn").textContent = "Explaining…";
    $("explanation").replaceChildren(
      section("Making sense of it", "Reading the passage and its context…"),
    );
    try {
      const result =
        explanationCache.get(key) ||
        (await Explanations.explain(text, context, level));
      if (version !== explanationVersion) return;
      if (explanationCache.size >= 30)
        explanationCache.delete(explanationCache.keys().next().value);
      explanationCache.set(key, result);
      renderExplanation(result);
    } catch (err) {
      if (version !== explanationVersion) return;
      $("explanation").replaceChildren(
        section("Could not explain this yet", err.message),
      );
      $("explanation").firstChild.classList.add("error");
    } finally {
      if (version === explanationVersion) {
        $("explain-btn").disabled = false;
        $("explain-btn").textContent = "Explain";
      }
    }
  }
  async function lookup(word) {
    const version = ++lookupVersion;
    $("word-content").textContent = "Looking up…";
    if (!$("word-dialog").open) $("word-dialog").showModal();
    try {
      // Try the exact compound first; deinflect only if it has no entry.
      let matches = await Dict.search(word);
      if (!matches.length) {
        const { dictionary } = await Morphology.getDictionaryForm(word);
        matches = await Dict.search(dictionary);
      }
      if (version !== lookupVersion) return;
      $("word-content").replaceChildren();
      if (!matches.length)
        $("word-content").append(
          section(
            word,
            "No dictionary entry found. Select the whole passage for an explanation.",
          ),
        );
      for (const item of matches.slice(0, 5)) {
        const card = document.createElement("section");
        card.className = "explanation-section";
        const h = document.createElement("h2");
        h.textContent = item.word || word;
        const reading = document.createElement("p");
        reading.className = "reading";
        reading.textContent = item.reading;
        const meaning = document.createElement("p");
        meaning.textContent = item.primaryMeaning;
        const pos = document.createElement("p");
        pos.className = "micro";
        pos.textContent = item.primaryPos;
        card.append(h, reading, meaning, pos);
        $("word-content").append(card);
      }
    } catch (err) {
      if (version === lookupVersion)
        $("word-content").textContent = err.message;
    }
  }
  function saveSession() {
    ReadingSession.save({ photo, annotations, bubbles, fullText });
    $("resume-btn").classList.remove("hidden");
  }
  function updateJump() {
    $("selection-jump").classList.toggle(
      "hidden",
      !unlocked || !$("selected-text").textContent.trim() ||
        $("reader").classList.contains("hidden"),
    );
  }
  $("selection-jump").onclick = () => {
    $("understand").scrollIntoView({ behavior: "smooth", block: "start" });
    explain();
  };
  // Keep the shortcut out of the way once the explanation controls are in view.
  new IntersectionObserver(
    (entries) => {
      $("selection-jump").classList.toggle(
        "offscreen-control",
        entries[0].isIntersecting,
      );
    },
    { threshold: 0.15 },
  ).observe($("understand"));
  for (const [id, delta] of [
    ["zoom-in", 0.5],
    ["zoom-out", -0.5],
  ])
    $(id).onclick = () => {
      zoom = Math.max(1, Math.min(3, zoom + delta));
      $("photo-container").style.width = `${zoom * 100}%`;
      $("zoom-label").textContent = `${zoom * 100}%`;
    };
  $("resume-btn").onclick = async () => {
    const saved = await ReadingSession.load();
    if (!saved) return showToast("No saved page on this device.");
    resetPage();
    ({ photo, annotations, bubbles, fullText } = saved);
    if (photo) {
      $("photo-img").src = photo.dataUrl;
      $("photo-container").classList.remove("hidden");
      $("photo-zoom").classList.remove("hidden");
    }
    $("page-status").textContent = "";
    renderPage();
  };
  $("forget-page").onclick = async () => {
    await ReadingSession.clear();
    $("resume-btn").classList.add("hidden");
    showToast("Saved page removed from this device.");
  };
  ReadingSession.load().then((saved) => {
    if (saved) $("resume-btn").classList.remove("hidden");
  });
  $("camera-btn").onclick = () => $("camera-input").click();
  $("upload-btn").onclick = () => $("upload-input").click();
  $("camera-input").onchange = importPhoto;
  $("upload-input").onchange = importPhoto;
  $("new-page").onclick = () => {
    resetPage();
    $("reader").classList.add("hidden");
    $("welcome").classList.remove("hidden");
  };
  $("retry-ocr").onclick = () => {
    pageVersion++;
    scan();
  };
  $("bubble-mode").onclick = () => {
    mode = "bubble";
    renderPage();
  };
  $("word-mode").onclick = () => {
    mode = "word";
    multiSelect = false;
    $("multi-select").setAttribute("aria-pressed", "false");
    $("tap-overlay").classList.remove("multi-select");
    renderPage();
  };
  $("multi-select").onclick = () => {
    multiSelect = !multiSelect;
    mode = "bubble";
    $("multi-select").setAttribute("aria-pressed", String(multiSelect));
    $("tap-overlay").classList.toggle("multi-select", multiSelect);
    renderPage();
  };
  let drag = null, suppressClick = false;
  const overlay = $("tap-overlay");
  overlay.addEventListener("click", event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  overlay.addEventListener("pointerdown", event => {
    if (!multiSelect || event.button !== 0) return;
    const rect = document.createElement("div");
    rect.className = "selection-rectangle";
    overlay.append(rect);
    drag = { x: event.clientX, y: event.clientY, initial: new Set(selected), rect, moved: false };
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener("pointermove", event => {
    if (!drag) return;
    const left = Math.min(drag.x, event.clientX), top = Math.min(drag.y, event.clientY);
    const right = Math.max(drag.x, event.clientX), bottom = Math.max(drag.y, event.clientY);
    if (right-left + bottom-top < 6 && !drag.moved) return;
    drag.moved = true;
    const bounds = overlay.getBoundingClientRect();
    Object.assign(drag.rect.style, {left: `${left-bounds.left}px`, top: `${top-bounds.top}px`, width: `${right-left}px`, height: `${bottom-top}px`});
    selected = new Set(drag.initial);
    overlay.querySelectorAll("[data-bubble]").forEach(target => {
      const box = target.getBoundingClientRect();
      if (box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom)
        selected.add(Number(target.dataset.bubble));
    });
    updateSelection();
  });
  overlay.addEventListener("pointerup", event => {
    if (!drag) return;
    if (!drag.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-bubble]");
      if (target) selectBubble(Number(target.dataset.bubble));
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    drag.rect.remove();
    drag = null;
  });
  overlay.addEventListener("pointercancel", () => {
    if (!drag) return;
    selected = drag.initial;
    drag.rect.remove();
    drag = null;
    updateSelection();
  });
  $("clear-selection").onclick = () => {
    selected.clear();
    updateSelection();
  };
  $("explain-btn").onclick = explain;
  try {
    const savedLevel = localStorage.getItem("yomu_level_v2");
    if (["N5", "N4", "N3", "N2", "N1"].includes(savedLevel))
      $("learner-level").value = savedLevel;
  } catch {}
  $("learner-level").onchange = () => {
    try {
      localStorage.setItem("yomu_level_v2", $("learner-level").value);
    } catch {}
    invalidateExplanation();
  };
  $("settings-btn").onclick = () => {
    $("settings-dialog").showModal();
  };
  $("settings-close").onclick = () => $("settings-dialog").close();
  $("word-close").onclick = () => $("word-dialog").close();
  $("word-dialog").addEventListener("close", () => {
    lookupVersion++;
  });
  for (const dialog of document.querySelectorAll("dialog"))
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          dialog.close();
      }
    });
  function lock() {
    unlocked = false;
    $("app-shell").classList.add("hidden");
    $("lock-screen").classList.remove("hidden");
    $("selection-jump").classList.add("hidden");
    for (const dialog of document.querySelectorAll("dialog")) dialog.close();
  }
  function unlock() {
    unlocked = true;
    $("lock-screen").classList.add("hidden");
    $("app-shell").classList.remove("hidden");
    $("password").value = "";
    $("login-error").textContent = "";
    updateJump();
  }
  window.addEventListener("yomu-locked", lock);
  $("login-form").onsubmit = async (event) => {
    event.preventDefault();
    $("unlock-btn").disabled = true;
    try { await API.request("login", {password: $("password").value}); unlock(); }
    catch (err) { $("login-error").textContent = err.message; }
    finally { $("unlock-btn").disabled = false; }
  };
  $("lock-btn").onclick = async () => {
    try { await API.request("logout", {}); lock(); }
    catch (err) { showToast(err.message); }
  };
  API.request("session").then(session => { if (session.authenticated) unlock(); }).catch(() => {});
  // Load the 69 MB dictionary only when a word is requested, not on every launch.
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  return { showToast };
})();
