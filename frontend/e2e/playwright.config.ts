import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser suite against a running stack (Go API + Next). Locally:
//   1. cp e2e/.env.example e2e/.env.local and fill the passwords
//   2. seed the accounts: cd backend/database && node --env-file=../../frontend/e2e/.env.local scripts/e2e-seed.js
//   3. pnpm e2e (all specs) or pnpm e2e:smoke (page walk only)
// .env.local is gitignored; CI passes the same variables as env.
const localEnv = path.join(__dirname, ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const chromium = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "Asia/Jakarta",
    colorScheme: "light",
    reducedMotion: "reduce",
    // The member app registers a service worker; cached responses would hide what the server returns.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "phone",
      use: { ...chromium, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: "tablet",
      use: { ...chromium, viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    { name: "desktop", use: { ...chromium, viewport: { width: 1280, height: 900 } } },
  ],
});
