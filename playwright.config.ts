import { defineConfig, devices } from "@playwright/test";

const e2eDb = process.env.CRM_DB_PATH || "crm-e2e.db";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: "http://127.0.0.1:4200/api/health",
    reuseExistingServer: !process.env.CI ? false : true,
    timeout: 180_000,
    env: {
      ...process.env,
      CRM_DB_PATH: e2eDb,
      CRM_FORCE_SQLITE: "1",
      NODE_ENV: process.env.NODE_ENV || "test",
      TELEGRAM_POLLING_IN_APP: "false",
      AVITO_POLL_INTERVAL_SECONDS: "9999",
      PORT: process.env.PORT || "4200",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
