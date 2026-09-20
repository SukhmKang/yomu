// Turn the JMdict index into a SQLite file the iOS app bundles.
// The web app splits this into 256 network-fetched shards; the phone just ships it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "data/index.json");
const outDir = path.join(root, "ios/Yomu/Resources");
const out = path.join(outDir, "jmdict.sqlite");
const dump = path.join(outDir, ".jmdict.sql");

if (!existsSync(source)) {
  console.error(`Missing ${source}. The dictionary source is required.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });

console.log("Reading dictionary…");
const index = JSON.parse(readFileSync(source, "utf8"));
const keys = Object.keys(index);
console.log(`${keys.length.toLocaleString()} keys`);

const escape = (s) => `'${String(s ?? "").replaceAll("'", "''")}'`;
const lines = [
  "PRAGMA journal_mode=OFF;",
  "PRAGMA synchronous=OFF;",
  "BEGIN;",
  "CREATE TABLE entries (key TEXT PRIMARY KEY, word TEXT, reading TEXT, meaning TEXT, pos TEXT, common INTEGER) WITHOUT ROWID;",
];

// The index is keyed by reading as well as by kanji, so a kana key like が collides
// with homographs (蛾 "moth"). Prefer the entry whose headword IS the key, which for
// a kana key is the real kana word, then prefer common entries.
function best(candidates) {
  const exact = candidates.filter((e) => e.w === key);
  const pool = exact.length ? exact : candidates;
  return pool.find((e) => e.c) ?? pool[0];
}

let key;
for (key of keys) {
  const candidates = index[key];
  if (!candidates?.length) continue;
  const e = best(candidates);
  if (!e) continue;
  lines.push(
    `INSERT INTO entries VALUES(${escape(key)},${escape(e.w)},${escape(e.r)},${escape(e.m)},${escape(e.p)},${e.c ? 1 : 0});`
  );
}
lines.push("COMMIT;", "VACUUM;");

console.log("Writing SQL…");
writeFileSync(dump, lines.join("\n"));

console.log("Building SQLite…");
execFileSync("sqlite3", [out], { input: readFileSync(dump), stdio: ["pipe", "inherit", "inherit"] });
rmSync(dump, { force: true });

const { size } = await import("node:fs").then((fs) => fs.promises.stat(out));
console.log(`Wrote ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`);
