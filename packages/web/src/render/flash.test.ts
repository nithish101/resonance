import { describe, expect, it } from "vitest";
import { FLASH_THRESHOLD, FlashLimiter } from "./flash";

/** Counts rises across the threshold in a rendered series, per sliding 1 s window. */
function maxFlashesPerSecond(series: { t: number; v: number }[]): number {
  const rises: number[] = [];
  let above = false;
  for (const { t, v } of series) {
    if (v >= FLASH_THRESHOLD && !above) rises.push(t);
    above = v >= FLASH_THRESHOLD;
  }
  let worst = 0;
  for (let i = 0; i < rises.length; i++) {
    let n = 0;
    for (let j = i; j < rises.length && rises[j]! - rises[i]! < 1; j++) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

/** A pulse train: value 1 for 30 ms at each of `hz` events per second, decaying after. */
function strobe(hz: number, seconds: number, fps = 120) {
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const phase = (t * hz) % 1;
    out.push({ t, v: phase < 0.03 * hz ? 1 : Math.exp(-(phase / hz) / 0.02) * 0.1 });
  }
  return out;
}

describe("flash limiter (AX-2, WCAG 2.3.1)", () => {
  it("passes slow flashing through unchanged", () => {
    const l = new FlashLimiter();
    const input = strobe(2, 5);
    const out = input.map(({ t, v }) => ({ t, v: l.apply(v, t) }));
    expect(out).toEqual(input);
    expect(l.suppressed).toBe(0);
  });

  it.each([4, 8, 12, 20])("caps a %d Hz strobe at 3 flashes per second", (hz) => {
    const l = new FlashLimiter();
    const out = strobe(hz, 6).map(({ t, v }) => ({ t, v: l.apply(v, t) }));
    expect(maxFlashesPerSecond(out)).toBeLessThanOrEqual(3);
    expect(l.suppressed).toBeGreaterThan(0);
  });

  it("still lets sub-threshold motion through while limiting", () => {
    const l = new FlashLimiter();
    for (let i = 0; i < 3; i++) {
      l.apply(1, i * 0.1); // three separate flashes
      l.apply(0, i * 0.1 + 0.05);
    }
    const capped = l.apply(1, 0.4);
    expect(capped).toBeLessThan(FLASH_THRESHOLD);
    expect(capped).toBeGreaterThan(0);
  });

  it("recovers once the window clears", () => {
    const l = new FlashLimiter();
    for (let i = 0; i < 3; i++) {
      l.apply(1, i * 0.1);
      l.apply(0, i * 0.1 + 0.05);
    }
    expect(l.apply(1, 1.25)).toBe(1);
  });
});
