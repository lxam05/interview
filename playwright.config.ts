import { defineConfig, devices } from "@playwright/test";
import { E2E_ENV, E2E_PORT } from "./e2e/env";

/*
 * npm run test:e2e
 *
 * Builds the app, starts it on its own port against an empty, freshly
 * migrated e2e database, and walks the main journey in Chromium.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx tsx e2e/reset-db.ts && npx next build && npx next start -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/api/health`,
    env: E2E_ENV,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
  },
});
