import { defineConfig, devices } from "@playwright/test";

// e2e runs against the production build (`vite preview`) so it exercises the same asset
// pipeline as the deployed site. Set E2E_DEV=1 to run against the dev server instead.
const dev = !!process.env.E2E_DEV;
const port = dev ? 5173 : 4173;

export default defineConfig({
  testDir: "tests",
  // One golden per test regardless of OS: SwiftShader renders identically on macOS and Linux
  // within the tolerance used by the visual tests.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}{ext}",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Each worker software-renders (SwiftShader); too many at once starves the audio threads.
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    // Everything renders in software (SwiftShader); a smaller viewport keeps 2-core CI runners
    // responsive. Visual tests set their own capture sizes.
    viewport: { width: 960, height: 540 },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /(tab-capture|webgpu)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 960, height: 540 },
        launchOptions: {
          args: [
            // Software GL so rendering is identical on every machine (PRD 9.1 visual tests).
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            // Fake capture devices for the mic and tab-capture tests.
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Fake audio output: no sound on the machine's speakers, and the AudioContext clock
            // runs from a timer instead of the hardware, so tests don't stall when the output
            // device is asleep (e.g. a laptop with its display off) and behave the same in CI.
            "--disable-audio-output",
          ],
        },
      },
    },
    // Headless SwiftShader WebGPU on Linux CI runners loses its device within seconds ("A valid
    // external Instance reference no longer exists"), so this project runs on macOS (SwiftShader
    // and Metal adapters both pass). See docs/plan.md, problem log.
    ...(process.platform === "linux" && process.env.CI
      ? []
      : [
          {
            // WebGPU path (RD-2): headless Chromium exposes a SwiftShader WebGPU adapter with this flag,
            // so the WebGPU renderer runs in CI without a GPU.
            name: "webgpu",
            testMatch: /webgpu\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              launchOptions: {
                // ANGLE on SwiftShader (Vulkan) lets the headless shell present WebGPU canvases;
                // without it getCurrentTexture() returns an invalid texture.
                args: [
                  "--enable-unsafe-webgpu",
                  "--use-angle=swiftshader",
                  "--enable-unsafe-swiftshader",
                  "--disable-audio-output",
                ],
              },
            },
          },
        ]),
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
            "--disable-audio-output",
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
