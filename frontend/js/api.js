const API = {
  async request(path, data) {
    let response;
    try {
      response = await fetch(`/api/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers:
          data === undefined ? {} : { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error(
        "Cannot reach the server. Check your connection and try again.",
      );
    }
    const result = await response.json();
    if (response.status === 401) window.dispatchEvent(new Event("yomu-locked"));
    if (!response.ok)
      throw new Error(result.error || "Request failed. Please retry.");
    return result;
  },
};
// Remove credentials saved by the old browser-only version.
try {
  for (const key of [
    "GOOGLE_VISION_API_KEY",
    "ANTHROPIC_API_KEY",
    "WANIKANI_API_TOKEN",
  ])
    localStorage.removeItem(`yomu_cfg_${key}`);
} catch {}
