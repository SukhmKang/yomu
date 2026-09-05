import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3100", serviceWorkers: "block" },
  projects: [
    {
      name: "iPhone WebKit",
      use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
    },
    { name: "desktop Chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "PORT=3100 APP_PASSWORD=browser-test-password node backend/server.js",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
  },
  reporter: "list",
});
