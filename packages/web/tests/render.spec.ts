import { expect, test } from "./fixtures";
import { luminanceStats, renderState, state, hideChrome } from "./helpers";

async function playAndShoot(page: import("@playwright/test").Page) {
  await page.getByTestId("track-deep-house-soul").click();
  await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(100);
  // Hide the UI chrome so the screenshot measures the canvas alone.
  await hideChrome(page);
  await page.waitForTimeout(500);
  return luminanceStats(await page.screenshot());
}

test.describe("rendering (M5)", () => {
  test("renders in a worker with WebGL2 and the canvas isn't blank", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => (await renderState(page)).renderer?.location).toBe("worker");
    expect((await renderState(page)).renderer?.backend).toBe("webgl2");
    const lum = await playAndShoot(page);
    expect(lum.mean).toBeGreaterThan(8);
    expect(lum.std).toBeGreaterThan(8);
    await expect.poll(async () => (await renderState(page)).render?.fps ?? 0).toBeGreaterThan(20);
  });

  test("falls back to main-thread rendering", async ({ page }) => {
    await page.goto("/?renderer=main");
    await expect.poll(async () => (await renderState(page)).renderer?.location).toBe("main");
    const lum = await playAndShoot(page);
    expect(lum.std).toBeGreaterThan(8);
  });

  test("renders with the postMessage transport too", async ({ page }) => {
    await page.goto("/?coi=0");
    const lum = await playAndShoot(page);
    expect(lum.std).toBeGreaterThan(8);
  });

  test("pauses rendering while the tab is hidden (RD-13)", async ({ page }) => {
    await page.goto("/");
    await expect.poll(async () => (await renderState(page)).render?.fps ?? 0).toBeGreaterThan(20);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await renderState(page)).render?.fps ?? -1).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(async () => (await renderState(page)).render?.fps ?? 0).toBeGreaterThan(20);
  });
});

test.describe("Particle Nebula on WebGL2 (RD-5) and context loss (RD-12)", () => {
  test("draws a non-blank nebula", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await page.evaluate(() =>
      (
        globalThis as unknown as {
          __resonance: { controller: { updateSettings(s: Record<string, unknown>): void } };
        }
      ).__resonance.controller.updateSettings({ mode: "nebula", particles: 60_000 }),
    );
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(100);
    const lum = await page.evaluate(() =>
      (
        globalThis as unknown as {
          __resonance: { controller: { probeFrame(): Promise<{ std: number; lit: number }> } };
        }
      ).__resonance.controller.probeFrame(),
    );
    // Mostly dark sky; what matters is that particles are visible.
    expect(lum.lit).toBeGreaterThan(0.002);
    expect(lum.std).toBeGreaterThan(5);
  });

  test("keeps rendering after the WebGL context is lost and restored", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(50);
    await page.evaluate(() =>
      (
        globalThis as unknown as { __resonance: { controller: { simulateGpuLoss(): void } } }
      ).__resonance.controller.simulateGpuLoss(),
    );
    await page.waitForTimeout(1200);
    await hideChrome(page);
    const lum = await luminanceStats(await page.screenshot());
    expect(lum.std).toBeGreaterThan(8);
    await expect.poll(async () => (await renderState(page)).render?.fps ?? 0).toBeGreaterThan(20);
  });
});

test("Chroma Bloom draws petals from live chroma (RD-6)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("track-deep-house-soul").click();
  await page.evaluate(() =>
    (
      globalThis as unknown as {
        __resonance: { controller: { updateSettings(s: Record<string, unknown>): void } };
      }
    ).__resonance.controller.updateSettings({ mode: "bloom" }),
  );
  await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(200);
  const lum = await page.evaluate(() =>
    (
      globalThis as unknown as {
        __resonance: { controller: { probeFrame(): Promise<{ std: number; lit: number }> } };
      }
    ).__resonance.controller.probeFrame(),
  );
  expect(lum.lit).toBeGreaterThan(0.002);
  expect(lum.std).toBeGreaterThan(5);
});
