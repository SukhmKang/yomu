// Pull term+reading popularity out of Jitendex. JMdict's own priority tags were
// collapsed to a single boolean in data/index.json, leaving nothing to rank
// homographs by; this restores that signal.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const scores = new Map();
let total = 0;
for (const file of readdirSync(".").filter((n) => n.startsWith("term_bank_"))) {
  for (const entry of JSON.parse(readFileSync(file, "utf8"))) {
    const key = `${entry[0]}\t${entry[1]}`;
    const score = entry[4] | 0;
    if (!scores.has(key) || score > scores.get(key)) scores.set(key, score);
    total++;
  }
}
const nonzero = [...scores].filter(([, v]) => v !== 0);
console.log(`${total} term entries -> ${scores.size} term+reading -> ${nonzero.length} scored`);
writeFileSync("/Users/sukhmkang/Developer/yomu/data/jitendex-scores.json",
              JSON.stringify(Object.fromEntries(nonzero)));
