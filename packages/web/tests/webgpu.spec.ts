import { expect, test } from "./fixtures";
import { renderState, state } from "./helpers";

/**
 * Luminance of the next frame read back from the GPU. Headless Chromium renders WebGPU but
 * doesn't always composite a worker's WebGPU canvas into page screenshots.
 */
function frame(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (
      globalThis as unknown as {
        __resonance: {
          controller: { probeFrame(): Promise<{ mean: number; std: number; lit: number }> };
        };
      }
    ).__resonance.controller.probeFrame(),
  );
}

const setMode = (page: import("@playwright/test").Page, mode: string, particles?: number) =>
  page.evaluate(
    ([m, p]) => {
      const c = (
        globalThis as unknown as {
          __resonance: { controller: { updateSettings(s: Record<string, unknown>): void } };
        }
      ).__resonance.controller;
      c.updateSettings(p ? { mode: m, particles: p } : { mode: m });
    },
    [mode, particles] as const,
  );

test.describe("WebGPU renderer (RD-2, RD-5, RD-12)", () => {
  // Software WebGPU (SwiftShader) is slow; a small viewport keeps the GPU process responsive.
  test.use({ viewport: { width: 640, height: 360 } });
  test.beforeEach(({ page }) => {
    page.on("worker", (w) =>
      w.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning")
          console.log(`[worker ${m.type()}]`, m.text());
      }),
    );
  });

  test("is chosen first and renders the tunnel", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => (await renderState(page)).renderer?.backend).toBe("webgpu");
    expect((await renderState(page)).renderer?.location).toBe("worker");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(100);
    const lum = await frame(page);
    expect(lum.std).toBeGreaterThan(8);
  });

  test("simulates and draws the Particle Nebula on the GPU", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => (await renderState(page)).renderer?.backend).toBe("webgpu");
    await page.getByTestId("track-deep-house-soul").click();
    await setMode(page, "nebula", 20_000);
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(100);
    const lum = await frame(page);
    expect(lum.lit).toBeGreaterThan(0.002); // visible particles
    expect(lum.std).toBeGreaterThan(5);
  });

  test("recovers from a lost device without reloading", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => (await renderState(page)).renderer?.backend).toBe("webgpu");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(50);
    await page.evaluate(() =>
      (
        globalThis as unknown as { __resonance: { controller: { simulateGpuLoss(): void } } }
      ).__resonance.controller.simulateGpuLoss(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              globalThis as unknown as {
                __resonance: { store: { getState(): { gpuRecoveries: number } } };
              }
            ).__resonance.store.getState().gpuRecoveries,
        ),
      )
      .toBe(1);
    const lum = await frame(page);
    expect(lum.std).toBeGreaterThan(8);
  });

  test("?renderer=webgl2 forces the WebGL2 worker", async ({ page }) => {
    await page.goto("/?renderer=webgl2");
    await expect.poll(async () => (await renderState(page)).renderer?.backend).toBe("webgl2");
  });
});
