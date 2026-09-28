// Build the iOS dictionary from Jitendex, the dictionary Yomitan itself uses.
//
// This was built from data/index.json, a JMdict-derived index, with Jitendex
// metadata bolted on. Running Yomitan's algorithm over a different dictionary
// gave different answers: Jitendex lists usually-kana words under their kana
// spelling — いる, やる, その — and Yomitan ranks those first, while the JMdict
// index had only 居る, 射る, 殺る, 園 to offer. Same algorithm, same data now.
//
// Usage: node scripts/build-ios-dict.mjs path/to/jitendex-yomitan.zip
// Jitendex: https://jitendex.org
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const zip = process.argv[2];
if (!zip) {
  console.error("Usage: node scripts/build-ios-dict.mjs path/to/jitendex-yomitan.zip");
  process.exit(1);
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
  return { meaning: senses[0] ?? "", pos: [...pos].join(" ") };
}

// --- Build ---------------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), "jitendex-"));
const outDir = path.join(root, "ios/Yomu/Resources");
const out = path.join(outDir, "jmdict.sqlite");
const dump = path.join(outDir, ".jmdict.sql");

try {
  console.log("Unpacking Jitendex…");
  execFileSync("unzip", ["-o", "-q", zip, "term_bank_*.json", "-d", work]);

  const byKey = new Map();
  let rows = 0;
  for (const file of readdirSync(work).filter((n) => n.startsWith("term_bank_"))) {
    // Yomitan term bank row: [term, reading, definitionTags, rules, score, glossary, sequence, termTags]
    for (const [term, reading, defTags, rules, score, glossary] of JSON.parse(readFileSync(path.join(work, file), "utf8"))) {
      const { meaning, pos } = describe(glossary);
      if (!meaning) continue;
      const entry = { term, reading: reading || term, meaning, pos, rules: rules ?? "",
                      score: score | 0, priority: /★/.test(defTags ?? "") };
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

  // Within a key, the order Yomitan's comparator falls through to once the source
  // text and inflection chain are equal: an exact match of the key first, then
  // score. The per-lookup tiers are applied in the app.
  const rank = (key) => (a, b) => (b.term === key) - (a.term === key) || b.score - a.score;

  const escape = (s) => `'${String(s ?? "").replaceAll("'", "''")}'`;
  const lines = [
    "PRAGMA journal_mode=OFF;", "PRAGMA synchronous=OFF;", "BEGIN;",
    "CREATE TABLE entries (key TEXT, rank INTEGER, word TEXT, reading TEXT, meaning TEXT, pos TEXT, common INTEGER, rules TEXT, score INTEGER);",
  ];
  for (const [key, entries] of byKey) {
    [...entries].sort(rank(key)).forEach((e, position) => {
      lines.push(`INSERT INTO entries VALUES(${escape(key)},${position},${escape(e.term)},${escape(e.reading)},` +
                 `${escape(e.meaning)},${escape(e.pos)},${e.priority ? 1 : 0},${escape(e.rules)},${e.score});`);
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
