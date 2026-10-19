import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL:
      process.env.TEST_BASE_URL || "http://127.0.0.1:4173/PaperTranslator/",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(process.env.CI ? {} : { channel: "msedge" }),
      },
    },
    ...(process.platform !== "win32" || process.env.PAPERTRANSLATOR_FIREFOX
      ? [{ name: "firefox", use: { browserName: "firefox" as const } }]
      : []),
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:4173/PaperTranslator/",
    reuseExistingServer: !process.env.CI,
  },
});
