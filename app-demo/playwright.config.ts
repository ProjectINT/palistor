import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the demo stand (app-demo) — the live check that the
 * library works in a real Next.js app, not only under jsdom.
 *
 * The demo consumes the library from source (tsconfig paths `@palistor/*`):
 * by default the package entry (Cube core); PALISTOR_IMPL=store runs the same
 * suite on the store reference implementation (tsconfig.store.json, :3002).
 *
 *   npm run test:e2e              # Cube — starts `next dev` on :3001 if not running
 *   npm run test:e2e:store        # store — `next dev` on :3002
 *   npm run test:e2e -- --ui      # Playwright UI
 */
const IMPL = process.env.PALISTOR_IMPL === "store" ? "store" : "cube";
const PORT = Number(process.env.E2E_PORT ?? (IMPL === "store" ? 3002 : 3001));

export default defineConfig({
  testDir: "./e2e",
  outputDir: `test-results/${IMPL}`,
  // Every test opens a fresh page, so the module-level stores start clean;
  // files run in parallel, the tests of one file in order.
  fullyParallel: false,
  workers: process.env.CI ? 1 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}/palistor/`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `PALISTOR_IMPL=${IMPL} npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/palistor/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
