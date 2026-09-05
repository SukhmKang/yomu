import { readFile, mkdir, writeFile } from 'node:fs/promises';
const dict = JSON.parse(await readFile(new URL('../data/index.json', import.meta.url), 'utf8'));
const shards = Array.from({ length: 256 }, () => ({}));
for (const [word, entries] of Object.entries(dict)) {
  let hash = 0; for (let i = 0; i < word.length; i++) hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
  shards[hash % 256][word] = entries;
}
const dest = new URL('../frontend/dict/entries/', import.meta.url); await mkdir(dest, { recursive: true });
await Promise.all(shards.map((shard,i) => writeFile(new URL(`${i}.json`, dest), JSON.stringify(shard))));
console.log(`Built ${Object.keys(dict).length} dictionary keys into 256 small lookup files.`);
