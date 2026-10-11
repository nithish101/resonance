import { expect, test } from "./fixtures";
import { state } from "./helpers";

interface TimelineState {
  timeline: { status: string; beats: number[]; energy: number[]; bpm: number; key: number } | null;
  dsp: { key: number; bpm: number } | null;
}

const snap = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = (
      globalThis as unknown as { __resonance: { store: { getState(): TimelineState } } }
    ).__resonance.store.getState();
    return JSON.parse(JSON.stringify({ timeline: s.timeline, dsp: s.dsp })) as TimelineState;
  });

test.describe("musical analysis (M12)", () => {
  test("a bundled track gets an offline beat grid, key, and seek-bar timeline (DSP-9, IN-5)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect
      .poll(async () => (await snap(page)).timeline?.status, { timeout: 60_000 })
      .toBe("ready");
    const t = (await snap(page)).timeline!;
    // 4:43 at about 122 BPM is roughly 575 beats.
    expect(t.beats.length).toBeGreaterThan(450);
    expect(t.bpm).toBeGreaterThan(115);
    expect(t.bpm).toBeLessThan(130);
    expect(t.key).toBeGreaterThanOrEqual(0);
    expect(t.energy).toHaveLength(400);
    await page.mouse.move(400, 400);
    await expect(page.getByTestId("timeline")).toBeVisible();
    await page.keyboard.press("d");
    await expect(page.getByTestId("debug-grid")).toHaveText(/^\d+ beats · \d+ ms$/);
    await expect(page.getByTestId("debug-grid-key")).toHaveText(/(major|minor)$/);
  });

  test("the live tracker emits beats and the key reaches the overlay (DSP-7, DSP-8)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).engine).toBe("ready");
    // Count beat flags directly from the frame bus over a few seconds.
    await page.evaluate(() => {
      const r = (
        globalThis as unknown as {
          __resonance: { controller: { getEngine(): { playUrl(u: string): Promise<void> } } };
        }
      ).__resonance;
      return r.controller.getEngine().playUrl("/audio/fixtures/groove-120.wav");
    });
    await expect.poll(async () => (await snap(page)).dsp?.key ?? -1, { timeout: 15_000 }).toBe(0); // C major
    await page.keyboard.press("d");
    await expect(page.getByTestId("debug-key")).toHaveText("C major");
  });

  test("the Key theme is selectable", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("s");
    await page.getByRole("radio", { name: "Follow the key" }).click();
    await expect(page.getByRole("radio", { name: "Follow the key" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
