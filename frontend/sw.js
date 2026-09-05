const CACHE = "yomu-v3";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/styles.css",
  "/js/session.js",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/js/api.js",
  "/js/app.js",
  "/js/camera.js",
  "/js/vision.js",
  "/js/explanations.js",
  "/js/dict.js",
  "/js/morphology.js",
  "/js/kuromoji.js",
  "/icons/icon.svg",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("yomu-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  const dictionary = url.pathname.startsWith("/dict/");
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (dictionary && cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        if (cached) return cached;
        if (event.request.mode === "navigate")
          return caches.match("/index.html");
        return new Response("Offline", { status: 503 });
      }
    })(),
  );
});
