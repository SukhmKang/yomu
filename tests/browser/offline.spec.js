import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "allow" });
test("locked app shell loads offline", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit network emulation returns an internal navigation error before the service worker can serve cached pages. Verify offline launch on a physical iPhone.",
  );
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#lock-screen")).toBeVisible();
});
