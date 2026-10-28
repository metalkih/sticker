import { defineConfig, devices } from "@playwright/test";
const externalBase = process.env.STICKER_TEST_BASE_URL;
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: externalBase || "http://127.0.0.1:8788",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: externalBase
    ? undefined
    : {
        command: "node --import tsx tests/ui-server.ts",
        url: "http://127.0.0.1:8788/healthz",
        reuseExistingServer: false,
        timeout: 20_000,
      },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
      },
    },
    {
      name: "iphone",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  reporter: [["list"]],
});
