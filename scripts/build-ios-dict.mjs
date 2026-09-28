// Build the iOS dictionary from Jitendex, the dictionary Yomitan itself uses.
//
// This was built from data/index.json, a JMdict-derived index, with Jitendex
// metadata bolted on. Running Yomitan's algorithm over a different dictionary
// gave different answers: Jitendex lists usually-kana words under their kana
// spelling — いる, やる, その — and Yomitan ranks those first, while the JMdict
// index had only 居る, 射る, 殺る, 園 to offer. Same algorithm, same data now.
//
// Frequencies come from JPDB, the frequency dictionary Yomitan users install to
// rank homographs: without one, Yomitan itself lists うえ as 飢え "hunger"
// before 上, and 前 as ぜん before まえ.
//
// Usage: node scripts/build-ios-dict.mjs [jitendex.zip] [jpdb-frequency.zip]
// Defaults: data/dictionaries/jitendex-yomitan.zip and
//           data/dictionaries/JPDB_v2.2_Frequency_Kana.zip
// Jitendex: https://jitendex.org
// JPDB frequency: https://github.com/Kuuuube/yomitan-dictionaries
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const zip = process.argv[2] ?? path.join(root, "data/dictionaries/jitendex-yomitan.zip");
const freqZip = process.argv[3] ?? path.join(root, "data/dictionaries/JPDB_v2.2_Frequency_Kana.zip");
for (const file of [zip, freqZip]) {
  if (!existsSync(file)) {
    console.error(`Missing ${path.relative(root, file)}. See the usage note at the top of this script.`);
    process.exit(1);
  }
}

// --- Reading Jitendex's structured content -----------------------------------
// Glosses sit under nodes tagged data.content === "glossary", grouped by
// "sense"; part-of-speech codes are on "part-of-speech-info" nodes.
const children = (node) =>
  node == null || typeof node === "string" ? [] : Array.isArray(node) ? node : [node.content].flat().filter(Boolean);

const text = (node) =>
  typeof node === "string" ? node
    : Array.isArray(node) ? node.map(text).join("")
    : node?.content != null ? text(node.content) : "";

function walk(node, visit) {
  if (node == null || typeof node === "string") return;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return; }
  visit(node);
  walk(node.content, visit);
}

function describe(glossary) {
  const senses = [];
  const pos = new Set();
  for (const item of glossary) {
    if (typeof item === "string") { senses.push(item); continue; }
    walk(item.content ?? item, (node) => {
      if (node.data?.content === "part-of-speech-info" && node.data.code) pos.add(node.data.code);
      if (node.data?.content === "sense") {
        const glosses = [];
        walk(node.content, (inner) => {
          if (inner.data?.content === "glossary") {
            for (const li of children(inner)) {
              const g = text(li).trim();
              if (g) glosses.push(g);
            }
          }
        });
        if (glosses.length) senses.push(glosses.join("; "));
      }
    });
  }
  return { meaning: senses[0] ?? "", senses, pos: [...pos].join(" ") };
}

// --- Build ---------------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), "jitendex-"));
const outDir = path.join(root, "ios/Yomu/Resources");
const out = path.join(outDir, "jmdict.sqlite");
const dump = path.join(outDir, ".jmdict.sql");

try {
  console.log("Unpacking Jitendex…");
  execFileSync("unzip", ["-o", "-q", zip, "term_bank_*.json", "-d", work]);

  // Frequency, as Yomitan applies it: a row with a reading counts only for that
  // reading, a row without one counts for the term; rank-based, so lowest wins.
  console.log("Reading JPDB frequencies…");
  const freqDir = path.join(work, "freq");
  execFileSync("unzip", ["-o", "-q", freqZip, "term_meta_bank_*.json", "-d", freqDir]);
  const byReading = new Map(), byTerm = new Map();
  const keepLowest = (map, key, value) => {
    if (typeof value === "number" && (!map.has(key) || value < map.get(key))) map.set(key, value);
  };
  for (const file of readdirSync(freqDir)) {
    for (const [term, mode, data] of JSON.parse(readFileSync(path.join(freqDir, file), "utf8"))) {
      if (mode !== "freq" || data == null) continue;
      if (typeof data === "object" && typeof data.reading === "string") {
        const f = data.frequency;
        keepLowest(byReading, `${term}\t${data.reading}`, typeof f === "object" ? f?.value : f);
      } else {
        keepLowest(byTerm, term, typeof data === "object" ? data.value : data);
      }
    }
  }
  const frequency = (term, reading) => {
    const candidates = [byReading.get(`${term}\t${reading}`), byTerm.get(term)].filter((v) => v != null);
    return candidates.length ? Math.min(...candidates) : null;
  };

  const byKey = new Map();
  let rows = 0;
  for (const file of readdirSync(work).filter((n) => n.startsWith("term_bank_"))) {
    // Yomitan term bank row: [term, reading, definitionTags, rules, score, glossary, sequence, termTags]
    for (const [term, reading, defTags, rules, score, glossary] of JSON.parse(readFileSync(path.join(work, file), "utf8"))) {
      const { meaning, senses, pos } = describe(glossary);
      if (!meaning) continue;
      const entry = { term, reading: reading || term, meaning, senses, pos, rules: rules ?? "",
                      score: score | 0, priority: /★/.test(defTags ?? ""),
                      freq: frequency(term, reading || term) };
      // Reachable by either spelling, as Yomitan looks up both.
      for (const key of new Set([term, reading || term])) {
        let bucket = byKey.get(key);
        if (!bucket) { bucket = []; byKey.set(key, bucket); }
        bucket.push(entry);
      }
      rows++;
    }
  }
  console.log(`${rows.toLocaleString()} entries, ${byKey.size.toLocaleString()} keys`);

  // Stored order within a key: Yomitan's static tiers — frequency, then score.
  // The tiers that depend on the lookup (inflection chain, exact source match)
  // are applied in the app. No frequency sorts last, as in Yomitan.
  const NONE = Number.MAX_SAFE_INTEGER;
  const rank = (a, b) => (a.freq ?? NONE) - (b.freq ?? NONE) || b.score - a.score;

  const escape = (s) => `'${String(s ?? "").replaceAll("'", "''")}'`;
  const lines = [
    "PRAGMA journal_mode=OFF;", "PRAGMA synchronous=OFF;", "BEGIN;",
    "CREATE TABLE entries (key TEXT, rank INTEGER, word TEXT, reading TEXT, meaning TEXT, pos TEXT, common INTEGER, rules TEXT, score INTEGER, freq INTEGER, senses TEXT);",
  ];
  for (const [key, entries] of byKey) {
    [...entries].sort(rank).forEach((e, position) => {
      lines.push(`INSERT INTO entries VALUES(${escape(key)},${position},${escape(e.term)},${escape(e.reading)},` +
                 `${escape(e.meaning)},${escape(e.pos)},${e.priority ? 1 : 0},${escape(e.rules)},${e.score},${e.freq ?? "NULL"},${escape(e.senses.join("\n"))});`);
    });
  }
  lines.push("CREATE INDEX entries_key ON entries(key, rank);", "COMMIT;", "VACUUM;");

  mkdirSync(outDir, { recursive: true });
  rmSync(out, { force: true });
  writeFileSync(dump, lines.join("\n"));
  console.log("Building SQLite…");
  execFileSync("sqlite3", [out], { input: readFileSync(dump), stdio: ["pipe", "ignore", "inherit"] });
  rmSync(dump, { force: true });
  const { size } = await fs.stat(out);
  console.log(`Wrote ${path.relative(root, out)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
