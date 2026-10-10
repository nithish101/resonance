import { expect, test } from "@playwright/test";
import { luminance, openCapture, renderAt } from "./capture-helpers";

/**
 * WCAG 2.3.1 general flashes, measured on rendered frames: a flash is a pair of opposing changes
 * in relative luminance of at least 0.1 where the darker state is below 0.8. Returns the largest
 * number of flashes in any one-second window. (Our flashes are full-frame, so the frame mean is
 * a conservative stand-in for the WCAG area rule.)
 */
function maxFlashesPerSecond(samples: { t: number; y: number }[]): number {
  const flashes: number[] = [];
  let low = true;
  let min = samples[0]!.y;
  let max = min;
  let riseAt = 0;
  for (const { t, y } of samples) {
    if (low) {
      min = Math.min(min, y);
      if (y - min >= 0.1 && min < 0.8) {
        low = false;
        max = y;
        riseAt = t;
      }
    } else {
      max = Math.max(max, y);
      if (max - y >= 0.1) {
        flashes.push(riseAt);
        low = true;
        min = y;
      }
    }
  }
  let worst = 0;
  for (let i = 0; i < flashes.length; i++) {
    let n = 0;
    for (let j = i; j < flashes.length && flashes[j]! - flashes[i]! < 1; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

async function series(
  page: import("@playwright/test").Page,
  from: number,
  to: number,
  fps: number,
) {
  const out: { t: number; y: number }[] = [];
  for (let t = from; t < to; t += 1 / fps) {
    await renderAt(page, t);
    out.push({ t, y: await luminance(page) });
  }
  return out;
}

test.describe("flash safety on rendered frames (AX-2)", () => {
  test.setTimeout(180_000);

  test("a 4-onsets-per-second strobe is limited to 3 flashes per second", async ({ page }) => {
    // Calibration mode is a full-screen black/white strobe on every onset, the worst case.
    await openCapture(page, {
      src: "/audio/fixtures/groove-120.wav",
      mode: "calibrate",
      w: 320,
      h: 180,
      fps: 60,
    });
    const s = await series(page, 3, 7, 60);
    const worst = maxFlashesPerSecond(s);
    expect(worst).toBeGreaterThan(0); // it does flash
    expect(worst).toBeLessThanOrEqual(3);
  });

  test("the tunnel on a dense click track stays within the limit", async ({ page }) => {
    await openCapture(page, { src: "/audio/fixtures/click-174.wav", w: 320, h: 180, fps: 60 });
    const s = await series(page, 3, 7, 60);
    expect(maxFlashesPerSecond(s)).toBeLessThanOrEqual(3);
  });
});
