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
  let zoom = 1;
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
    $("explain-btn").textContent = "Explain this ↗";
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
    $("selected-text").value = "";
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
    $("selected-text").value = [...selected]
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
    $("selection-hint").textContent =
      mode === "bubble"
        ? "Tap a bubble to select it. Select more to join a passage."
        : "Tap a word for its reading and definition.";
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
  function readText() {
    const text = $("paste-text").value.trim();
    if (!text) return showToast("Paste a little Japanese text first.");
    resetPage();
    fullText = text;
    bubbles = text
      .split(/\n+/)
      .filter((s) => s.trim())
      .map((description) => ({ description }));
    $("page-status").textContent =
      `${bubbles.length} passage${bubbles.length === 1 ? "" : "s"} · ready to read`;
    renderPage();
    selectBubble(0);
    saveSession();
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
        `${bubbles.length} text regions · ready to read`;
      $("scan-state").classList.add("hidden");
      renderPage();
      saveSession();
    } catch (err) {
      if (version !== pageVersion) return;
      $("scan-state").textContent =
        `${err.message} You can also type the passage beside the page.`;
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
    const container = $("explanation");
    container.replaceChildren();
    container.append(
      section("In simple Japanese", result.simpleJapanese, "ja"),
      section("What it means", result.meaning),
      section("Reading", result.reading, "ja"),
    );
    if (result.grammar.length) {
      const group = section("How it works", "");
      result.grammar.forEach((item) => {
        const div = document.createElement("div");
        div.className = "grammar-item";
        const strong = document.createElement("strong");
        strong.textContent = item.pattern;
        const p = document.createElement("p");
        p.textContent = item.explanation;
        div.append(strong, p);
        group.append(div);
      });
      container.append(group);
    }
    container.append(section("Between the lines", result.nuance));
    const note = document.createElement("p");
    note.className = "micro";
    note.textContent =
      "AI explanations can miss nuance. Correct the selected text if the scan looks wrong.";
    note.style.marginTop = "20px";
    container.append(note);
  }
  async function explain() {
    const text = $("selected-text").value.trim();
    if (!text) return showToast("Select a bubble or enter a passage first.");
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
        $("explain-btn").textContent = "Explain this ↗";
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
  async function serviceStatus() {
    try {
      const status = await API.request("status");
      $("service-status").textContent =
        status.vision && status.explanations
          ? "● Ready to read"
          : "○ Server setup needed";
      $("connection-details").replaceChildren();
      for (const [label, ready] of [
        ["Photo scanning", status.vision],
        ["Passage explanations", status.explanations],
      ]) {
        const p = document.createElement("p");
        p.textContent = `${ready ? "●" : "○"} ${label} — ${ready ? "configured" : "add credentials to backend .env / Render environment"}`;
        $("connection-details").append(p);
      }
    } catch {
      $("service-status").textContent =
        "○ Offline · dictionary available once loaded";
      $("connection-details").textContent =
        "The backend is unreachable. Check your connection and deployment.";
    }
  }
  function saveSession() {
    ReadingSession.save({ photo, annotations, bubbles, fullText });
    $("resume-btn").classList.remove("hidden");
  }
  function updateJump() {
    $("selection-jump").classList.toggle(
      "hidden",
      !$("selected-text").value.trim() ||
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
    $("page-status").textContent = "Last page · ready to read";
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
  $("read-btn").onclick = readText;
  $("demo-btn").onclick = () => {
    $("paste-text").value =
      "そんなに無理しなくてもいいんだよ。\nたまには、立ち止まってもいい。";
    readText();
  };
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
    renderPage();
  };
  $("clear-selection").onclick = () => {
    selected.clear();
    updateSelection();
  };
  $("selected-text").oninput = invalidateExplanation;
  $("explain-btn").onclick = explain;
  try {
    const savedLevel = localStorage.getItem("yomu_level");
    if (["N5", "N4", "N3", "N2", "N1"].includes(savedLevel))
      $("learner-level").value = savedLevel;
  } catch {}
  $("learner-level").onchange = () => {
    try {
      localStorage.setItem("yomu_level", $("learner-level").value);
    } catch {}
    invalidateExplanation();
  };
  $("settings-btn").onclick = () => {
    serviceStatus();
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
  window.addEventListener("online", serviceStatus);
  window.addEventListener("offline", () => {
    $("service-status").textContent = "○ Offline";
  });
  serviceStatus();
  // Load the 69 MB dictionary only when a word is requested, not on every launch.
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  return { showToast };
})();
