import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
test("Japanese compounds retain the union of vertical character boxes", async () => {
  const box = (y) => ({
    vertices: [
      { x: 100, y },
      { x: 120, y },
      { x: 120, y: y + 20 },
      { x: 100, y: y + 20 },
    ],
  });
  const result = {
    textAnnotations: [
      { description: "日本語" },
      { description: "日", boundingPoly: box(0) },
    ],
    fullTextAnnotation: {
      text: "日本語",
      pages: [
        {
          blocks: [
            {
              paragraphs: [
                {
                  boundingBox: {
                    vertices: [
                      { x: 100, y: 0 },
                      { x: 120, y: 0 },
                      { x: 120, y: 60 },
                      { x: 100, y: 60 },
                    ],
                  },
                  words: [
                    {
                      symbols: [..."日本語"].map((text, i) => ({
                        text,
                        boundingBox: box(i * 20),
                      })),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const sandbox = { API: { request: async () => result }, Intl };
  vm.createContext(sandbox);
  vm.runInContext(
    (await readFile("frontend/js/vision.js", "utf8")) +
      "\nglobalThis.vision=Vision;",
    sandbox,
  );
  const parsed = await sandbox.vision.detectText("image");
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.annotations[0].description, "日本語");
  assert.equal(parsed.annotations[0].boundingPoly.vertices[2].y, 60);
  assert.equal(parsed.bubbles[0].description, "日本語");
});
