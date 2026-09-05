import { test, expect } from "@playwright/test";
const result = {
  reading: "そんなにむりしなくてもいいんだよ。",
  simpleJapanese: "がんばりすぎなくてもいい。",
  meaning: "You don’t have to push yourself so hard.",
  nuance: "A gentle reassurance.",
  grammar: [{ pattern: "なくてもいい", explanation: "It is okay not to." }],
};
async function photo(page) {
  await page.route("**/api/vision", route => route.fulfill({json: {
    textAnnotations: [{description: "そんなに無理しなくてもいいんだよ。"}, {description: "無理", boundingPoly: {vertices: [{x:20,y:20},{x:160,y:20},{x:160,y:100},{x:20,y:100}]}}]
  }}));
  await page.locator("#upload-input").setInputFiles("frontend/icons/icon-512.png");
  await page.locator(".tap-target").first().click();
}
test.beforeEach(async ({page}) => {
  await page.route("**/api/session", route => route.fulfill({json: {authenticated: true}}));
});
test("photo selection, explanation cache, level and dictionary", async ({page}) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  let count = 0;
  await page.route("**/api/explain", route => { count++; return route.fulfill({json: result}); });
  await page.goto("/");
  await expect(page.locator("#welcome")).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await photo(page);
  await expect(page.locator("#learner-level")).toHaveValue("N2");
  await page.locator("#explain-btn").click();
  await expect(page.getByText(result.simpleJapanese, {exact:true})).toBeVisible();
  await page.locator("#explain-btn").click();
  expect(count).toBe(1);
  await page.locator("#learner-level").selectOption("N4");
  await page.locator("#explain-btn").click();
  await expect(page.getByText(result.simpleJapanese, {exact:true})).toBeVisible();
  expect(count).toBe(2);
  await page.locator("#word-mode").click();
  await page.locator(".tap-target").first().click();
  await expect(page.locator("#word-content")).toContainText("むり");
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
  await expect(page.locator("#selected-text")).toHaveText("日本語\n漫画");
  await expect(page.locator(".tap-target.active")).toHaveCount(2);
  await page.locator(".tap-target").first().click();
  await expect(page.locator("#selected-text")).toHaveText("漫画");
  await page.locator("#clear-selection").click();
  await expect(page.locator("#multi-select")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#photo-container").scrollIntoViewIfNeeded();
  await page.locator(".tap-target").first().hover();
  const first = await page.locator(".tap-target").first().boundingBox();
  const last = await page.locator(".tap-target").nth(1).boundingBox();
  await page.mouse.move(first.x + 1, first.y + 1);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height - 1, {steps: 8});
  await page.mouse.up();
  await expect(page.locator(".tap-target.active")).toHaveCount(2);
  await expect(page.locator("#selected-text")).toHaveText("日本語\n漫画");

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
  await photo(page);
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await page.locator("#clear-selection").click();
  release();
  await expect(
    page.getByRole("button", { name: "Explain", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(result.simpleJapanese, { exact: true })).toHaveCount(0);
});
test("last page survives reopening, can be forgotten, and uses only local storage", async ({
  page,
}) => {
  await page.goto("/");
  await photo(page);
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.locator("#resume-btn")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.locator("#photo-container")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Forget saved page" }).click();
  await page.getByRole("button", { name: "Close preferences" }).click();
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.locator("#resume-btn")).toBeHidden();
});

test("unlock is remembered after reopening and Lock clears it", async ({page, context}) => {
  await page.unroute("**/api/session");
  await page.goto("/");
  await expect(page.locator("#lock-screen")).toBeVisible();
  await page.locator("#password").fill("incorrect");
  await page.locator("#unlock-btn").click();
  await expect(page.locator("#login-error")).toContainText("Incorrect");
  await page.locator("#password").fill("browser-test-password");
  await page.locator("#unlock-btn").click();
  await expect(page.locator("#welcome")).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find(c => c.name === "yomu_session").httpOnly).toBe(true);
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.locator("#welcome")).toBeVisible();
  await reopened.locator("#settings-btn").click();
  await reopened.locator("#lock-btn").click();
  await expect(reopened.locator("#lock-screen")).toBeVisible();
  await reopened.reload();
  await expect(reopened.locator("#app-shell")).toBeHidden();
});

test("next photo and upload replace the page directly with multi-select enabled", async ({page}) => {
  await page.goto("/");
  await photo(page);
  await expect(page.locator("#multi-select")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#multi-select").click();
  const cameraChooser = page.waitForEvent("filechooser");
  await page.locator("#next-photo").click();
  const camera = await cameraChooser;
  await expect(page.locator("#reader")).toBeVisible();
  await camera.setFiles("frontend/icons/icon-192.png");
  await expect(page.locator(".tap-target")).toHaveCount(1);
  await expect(page.locator("#selected-text")).toBeEmpty();
  await expect(page.locator("#multi-select")).toHaveAttribute("aria-pressed", "true");
  const uploadChooser = page.waitForEvent("filechooser");
  await page.locator("#next-upload").click();
  await (await uploadChooser).setFiles("frontend/icons/icon-512.png");
  await expect(page.locator(".tap-target")).toHaveCount(1);
  await expect(page.locator("#welcome")).toBeHidden();
});
