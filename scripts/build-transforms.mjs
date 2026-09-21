// Turn Yomitan's Japanese inflection rules into JSON the iOS app can load.
//
// The rules are typed: each one declares which grammatical conditions it consumes
// and produces, so a chain cannot run through a form that could not have produced
// it. That is what a hand-written table lacks, and why one over-generates.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const { japaneseTransforms } = await import(
  path.join(root, "vendor/yomitan/ext/js/language/ja/japanese-transforms.js")
);
const { conditions, transforms } = japaneseTransforms;

const PROBE = "あ";

const encodeRule = (rule, transformId, index) => {
  const where = `${transformId}[${index}]`;
  const source = rule.isInflected.source;
  const shared = { conditionsIn: rule.conditionsIn, conditionsOut: rule.conditionsOut };

  if (rule.type === "wholeWord") {
    if (!source.startsWith("^") || !source.endsWith("$")) {
      throw new Error(`${where}: unexpected whole-word pattern ${source}`);
    }
    const inflected = source.slice(1, -1);
    return { type: "wholeWord", inflected, deinflected: rule.deinflect(inflected), ...shared };
  }

  if (rule.type !== "suffix") throw new Error(`${where}: unsupported rule type ${rule.type}`);
  if (!source.endsWith("$")) throw new Error(`${where}: unexpected suffix pattern ${source}`);

  const inflected = source.slice(0, -1);
  // Confirm the recovered pair reproduces what the closure actually does.
  if (rule.deinflect(PROBE + inflected) !== PROBE + rule.deinflected) {
    throw new Error(`${where}: ${inflected} -> ${rule.deinflected} disagrees with deinflect()`);
  }
  return { type: "suffix", inflected, deinflected: rule.deinflected, ...shared };
};

const out = {
  source: "yomitan",
  conditions: Object.fromEntries(
    Object.entries(conditions).map(([id, c]) => [id, {
      isDictionaryForm: !!c.isDictionaryForm,
      subConditions: c.subConditions ?? null,
    }])
  ),
  transforms: Object.entries(transforms).map(([id, t]) => ({
    id,
    name: t.name,
    rules: t.rules.map((rule, index) => encodeRule(rule, id, index)),
  })),
};

const total = out.transforms.reduce((n, t) => n + t.rules.length, 0);
const dir = path.join(root, "ios/Yomu/Resources");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "japanese-transforms.json"), JSON.stringify(out));
console.log(`${out.transforms.length} transforms, ${total} rules, ${Object.keys(out.conditions).length} conditions`);
