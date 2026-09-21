// Turn the JMdict index into a SQLite file the iOS app bundles.
//
// Every candidate for a key is kept. An earlier version stored one row per key and
// picked a winner here, which discarded ~96,500 entries and decided — by JMdict's
// file order — which meaning the reader would see. When that pick was wrong there
// was no second candidate, so the only recourse downstream was to suppress the
// word entirely, which then hid correct entries too.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, promises as fs } from "node:fs";
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

// The supplied index is not consistently cross-referenced by reading: 時 is
// reachable under とき but 事 is not under こと, which is why こと resolved to
// 琴 "koto zither". Index every entry under both its headword and its reading.
const byKey = new Map();
const add = (key, entry) => {
  if (!key) return;
  let bucket = byKey.get(key);
  if (!bucket) { bucket = []; byKey.set(key, bucket); }
  if (!bucket.some((e) => e.w === entry.w && e.r === entry.r)) bucket.push(entry);
};
for (const [key, entries] of Object.entries(index)) {
  for (const entry of entries) {
    add(key, entry);
    add(entry.w, entry);
    add(entry.r, entry);
  }
}
console.log(`${byKey.size.toLocaleString()} keys`);

// Rank, don't discard. data/index.json collapsed JMdict's priority tags into one
// boolean, which cannot separate homographs — 事 and 琴 are both simply "common",
// so とき resolved to 刻 and こと to 琴 on nothing better than file order.
// Jitendex keeps a popularity score per headword+reading; scripts/build-scores.mjs
// extracts it.
const scoresPath = path.join(root, "data/jitendex-scores.json");
const scores = existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf8")) : {};
if (!Object.keys(scores).length) {
  console.warn("No data/jitendex-scores.json — homographs will be ordered arbitrarily.");
}
const score = (e) => scores[`${e.w}\t${e.r}`] ?? 0;

const rank = (key) => (a, b) =>
  (b.w === key) - (a.w === key) ||
  score(b) - score(a) ||
  (b.c ? 1 : 0) - (a.c ? 1 : 0) ||
  (b.s?.length ?? 0) - (a.s?.length ?? 0);

const escape = (s) => `'${String(s ?? "").replaceAll("'", "''")}'`;
const lines = [
  "PRAGMA journal_mode=OFF;",
  "PRAGMA synchronous=OFF;",
  "BEGIN;",
  "CREATE TABLE entries (key TEXT, rank INTEGER, word TEXT, reading TEXT, meaning TEXT, pos TEXT, common INTEGER);",
];

let rows = 0;
for (const [key, entries] of byKey) {
  const ordered = [...entries].sort(rank(key));
  ordered.forEach((e, position) => {
    rows++;
    lines.push(
      `INSERT INTO entries VALUES(${escape(key)},${position},${escape(e.w)},${escape(e.r)},${escape(e.m)},${escape(e.p)},${e.c ? 1 : 0});`
    );
  });
}
lines.push("CREATE INDEX entries_key ON entries(key, rank);", "COMMIT;", "VACUUM;");

console.log(`Writing SQL… (${rows.toLocaleString()} rows)`);
writeFileSync(dump, lines.join("\n"));

console.log("Building SQLite…");
execFileSync("sqlite3", [out], { input: readFileSync(dump), stdio: ["pipe", "inherit", "inherit"] });
rmSync(dump, { force: true });

const { size } = await fs.stat(out);
console.log(`Wrote ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`);
