import { expect, test } from "./fixtures";
import { luminanceStats, renderState, state } from "./helpers";

async function playAndShoot(page: import("@playwright/test").Page) {
  await page.getByTestId("track-deep-house-soul").click();
  await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(100);
  // Hide the UI chrome so the screenshot measures the canvas alone.
  await page.addStyleTag({ content: ".chrome { display: none !important; }" });
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
