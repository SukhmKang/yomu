import { test, expect } from "@playwright/test";
const result = {
  reading: "そんなにむりしなくてもいいんだよ。",
  simpleJapanese: "がんばりすぎなくてもいい。",
  meaning: "You don’t have to push yourself so hard.",
  nuance: "A gentle reassurance.",
  grammar: [{ pattern: "なくてもいい", explanation: "It is okay not to." }],
};
test.beforeEach(async ({ page }) => {
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { vision: true, explanations: true } }),
  );
});
test("phone reading flow: selection, explanation, cache, correction, level, dictionary", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let count = 0;
  await page.route("**/api/explain", async (route) => {
    count++;
    expect(route.request().postDataJSON().text).toContain("そんなに");
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Stay in the story." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(page.locator("#selected-text")).toHaveValue(
    "そんなに無理しなくてもいいんだよ。",
  );
  await page.getByRole("button", { name: "Explain this" }).click();
  await expect(page.getByText(result.meaning, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explain this" }).click();
  expect(count).toBe(1);
  await page.locator("#learner-level").selectOption("N4");
  await page.getByRole("button", { name: "Explain this" }).click();
  await expect(page.getByText(result.meaning, { exact: true })).toBeVisible();
  expect(count).toBe(2);
  await page.getByRole("button", { name: "Words", exact: true }).click();
  await page.getByRole("button", { name: "無理", exact: true }).click();
  await expect(page.locator("#word-content")).toContainText("むり");
  await page.getByRole("button", { name: "Close definition" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.locator("#welcome")).toBeVisible();
  expect(errors).toEqual([]);
});
test("OCR upload, combine bubbles, word lookup and retry", async ({ page }) => {
  let attempts = 0;
  const box = (x, y) => ({
    vertices: [
      { x, y },
      { x: x + 120, y },
      { x: x + 120, y: y + 60 },
      { x, y: y + 60 },
    ],
  });
  const paragraph = (text, x, y) => ({
    boundingBox: box(x, y),
    words: [{ symbols: [...text].map((text) => ({ text })) }],
  });
  await page.route("**/api/vision", (route) => {
    attempts++;
    return route.fulfill(
      attempts === 1
        ? { status: 502, json: { error: "Scan interrupted. Try again." } }
        : {
            json: {
              textAnnotations: [
                { description: "日本語漫画" },
                { description: "日本語", boundingPoly: box(20, 20) },
                { description: "漫画", boundingPoly: box(200, 200) },
              ],
              fullTextAnnotation: {
                text: "日本語漫画",
                pages: [
                  {
                    blocks: [
                      {
                        paragraphs: [
                          paragraph("日本語", 20, 20),
                          paragraph("漫画", 200, 200),
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
    );
  });
  await page.goto("/");
  await expect(page.locator("#camera-input")).toHaveAttribute(
    "capture",
    "environment",
  );
  await page
    .locator("#upload-input")
    .setInputFiles("frontend/icons/icon-512.png");
  await expect(page.locator("#scan-state")).toContainText("Scan interrupted");
  await page.getByRole("button", { name: "Retry scan" }).click();
  await page.locator(".tap-target").first().click();
  await page.locator(".tap-target").nth(1).click();
  await expect(page.locator("#selected-text")).toHaveValue("日本語\n漫画");
  await expect(page.locator(".tap-target.active")).toHaveCount(2);
  await page.locator(".tap-target").first().click();
  await expect(page.locator("#selected-text")).toHaveValue("漫画");
});
test("editing a selection discards an in-flight explanation", async ({
  page,
}) => {
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route("**/api/explain", async (route) => {
    await gate;
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Explain this" }).click();
  await page.locator("#selected-text").fill("違う文章。");
  release();
  await expect(
    page.getByRole("button", { name: "Explain this" }),
  ).toBeEnabled();
  await expect(page.getByText(result.meaning, { exact: true })).toHaveCount(0);
});
test("last page survives reopening, can be forgotten, and uses only local storage", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.locator("#resume-btn")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Continue your last page" }).click();
  await expect(page.locator("#text-page")).toContainText("そんなに無理");
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByRole("button", { name: "Forget saved page" }).click();
  await page.getByRole("button", { name: "Close preferences" }).click();
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.locator("#resume-btn")).toBeHidden();
});
