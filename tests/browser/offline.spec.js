import { test, expect } from "@playwright/test";
test.use({ serviceWorkers: "allow" });
test("installed app shell and previously loaded dictionary work offline", async ({
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
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Words", exact: true }).click();
  await page.getByRole("button", { name: "無理", exact: true }).click();
  await expect(page.locator("#word-content")).toContainText("むり");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Stay in the story." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.getByRole("button", { name: "Words", exact: true }).click();
  await page.getByRole("button", { name: "無理", exact: true }).click();
  await expect(page.locator("#word-content")).toContainText("むり");
});
