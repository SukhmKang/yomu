// Keep only the most recent page on this device. Never send it anywhere on restore.
const ReadingSession = {
  async access(mode, value) {
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("yomu-reader", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("pages");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(
            "pages",
            mode === "get" ? "readonly" : "readwrite",
          );
          const store = tx.objectStore("pages");
          const req =
            mode === "get"
              ? store.get("last")
              : mode === "clear"
                ? store.delete("last")
                : store.put(value, "last");
          tx.oncomplete = () => resolve(req.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } catch {
      return null;
    } // Private browsing or a full device must not break reading.
  },
  load() {
    return this.access("get");
  },
  save(value) {
    return this.access("put", value);
  },
  clear() {
    return this.access("clear");
  },
};
