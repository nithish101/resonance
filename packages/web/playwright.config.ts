import { defineConfig, devices } from "@playwright/test";

// e2e runs against the production build (`vite preview`) so it exercises the same asset
// pipeline as the deployed site. Set E2E_DEV=1 to run against the dev server instead.
const dev = !!process.env.E2E_DEV;
const port = dev ? 5173 : 4173;

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /tab-capture\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            // Software GL so rendering is identical on every machine (PRD 9.1 visual tests).
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            // Fake capture devices for the mic and tab-capture tests.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
    {
      // Real tab capture needs full Chromium (the default headless shell rejects
      // getDisplayMedia). The flag auto-picks the tab titled "ToneSource" in the share dialog.
      name: "tab-capture",
      testMatch: /tab-capture\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        launchOptions: {
          args: [
            "--auto-select-tab-capture-source-by-title=ToneSource",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
      },
    },
  ],
  webServer: {
    command: dev ? "pnpm exec vite" : "pnpm exec vite build && pnpm exec vite preview",
    env: { RESONANCE_TEST_PAGES: "1" },
    port,
    // Always build fresh: reusing a stray preview server silently tests a stale build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
