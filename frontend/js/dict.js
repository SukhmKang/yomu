const Dict = (() => {
  const shards = new Map();
  async function search(word) {
    let hash = 0;
    for (let i = 0; i < word.length; i++)
      hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
    const id = hash % 256;
    if (!shards.has(id)) {
      shards.set(
        id,
        fetch(`/dict/entries/${id}.json`)
          .then((r) => {
            if (!r.ok) throw new Error();
            return r.json();
          })
          .catch(() => {
            shards.delete(id);
            throw new Error(
              "The dictionary could not load. Check your connection and retry.",
            );
          }),
      );
    }
    const index = await shards.get(id);
    return (index[word] || []).map((e) => ({
      word: e.w,
      reading: e.r,
      primaryMeaning: e.m,
      primaryPos: e.p || "",
    }));
  }
  return { search };
})();
