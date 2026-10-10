import { expect, test } from "./fixtures";
import { luminanceStats, hideChrome } from "./helpers";

interface Timing {
  mode: number;
  syncErrorMs: number;
  syncErrorP95: number;
  leadMs: number;
  inputLatencyMs: number;
}

const timing = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __resonance: { store: { getState(): { render: Timing | null } } };
        }
      ).__resonance.store.getState().render,
  );

test.describe("timing and A/V sync (PRD 6.3)", () => {
  test("file mode targets the audible moment with a positive analysis lead", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await timing(page))?.mode).toBe(1);
    await page.waitForTimeout(1500);
    const t = (await timing(page))!;
    // Visuals show the frame for the output time; analysis must stay ahead of it.
    expect(t.syncErrorP95).toBeLessThanOrEqual(15);
    expect(t.leadMs).toBeGreaterThan(20);
    await page.keyboard.press("d");
    await expect(page.getByTestId("debug-sync")).toHaveText(/^\d+\.\d · \d+\.\d ms$/);
  });

  test("live mode reports an input latency estimate", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("mic-button").click();
    await expect.poll(async () => (await timing(page))?.mode).toBe(2);
    await expect.poll(async () => (await timing(page))?.inputLatencyMs ?? 0).toBeGreaterThan(5);
    expect((await timing(page))!.inputLatencyMs).toBeLessThan(150);
    await page.keyboard.press("d");
    await expect(page.getByTestId("debug-sync")).toHaveText(/ms$/);
  });

  test("calibration mode flashes white on clicks and is black between them", async ({ page }) => {
    await page.goto("/?calibrate=1");
    await page.getByTestId("track-calibration").click();
    await hideChrome(page);
    const means: number[] = [];
    for (let i = 0; i < 24; i++) {
      means.push((await luminanceStats(await page.screenshot())).mean);
      await page.waitForTimeout(40);
    }
    expect(Math.max(...means)).toBeGreaterThan(200);
    expect(Math.min(...means)).toBeLessThan(5);
  });
});
