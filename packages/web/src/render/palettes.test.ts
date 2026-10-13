import { describe, expect, it } from "vitest";
import { TEMPO_THEME, tempoPalette, type Palette } from "./palettes";

const fresh = (): Palette => ({
  ...TEMPO_THEME,
  a: [0, 0, 0],
  b: [0, 0, 0],
  c: [1, 1, 1],
  d: [0, 0, 0],
});
const colour = (p: Palette, t: number) =>
  [0, 1, 2].map((i) =>
    Math.min(1, Math.max(0, p.a[i]! + p.b[i]! * Math.cos(2 * Math.PI * (p.c[i]! * t + p.d[i]!)))),
  );

describe("tempo palette", () => {
  it("changes gradually with tempo (no jumps between neighbouring BPMs)", () => {
    for (let bpm = 60; bpm < 180; bpm++) {
      const x = tempoPalette(bpm, fresh());
      const y = tempoPalette(bpm + 1, fresh());
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(x.a[i]! - y.a[i]!)).toBeLessThan(0.02);
        expect(Math.abs(x.d[i]! - y.d[i]!)).toBeLessThan(0.05);
      }
    }
  });

  it("is blue when slow, warmest at house tempo, and violet when fast", () => {
    // Mean red and blue over the whole gradient.
    const mean = (bpm: number) => {
      const p = tempoPalette(bpm, fresh());
      let r = 0;
      let b = 0;
      for (let t = 0; t < 1; t += 0.01) {
        const c = colour(p, t);
        r += c[0]!;
        b += c[2]!;
      }
      return { r: r / 100, b: b / 100 };
    };
    const slow = mean(80);
    const house = mean(124);
    const fast = mean(170);
    expect(slow.b).toBeGreaterThan(slow.r);
    expect(house.r - house.b).toBeGreaterThan(slow.r - slow.b);
    expect(house.r - house.b).toBeGreaterThan(fast.r - fast.b);
    expect(fast.b).toBeGreaterThan(house.b);
  });

  it("never produces saturated red, which the flash-safety rules avoid (AX-2)", () => {
    for (let bpm = 60; bpm <= 180; bpm += 2) {
      const p = tempoPalette(bpm, fresh());
      for (let t = 0; t <= 1; t += 0.02) {
        const [r, g, b] = colour(p, t) as [number, number, number];
        if (r + g + b > 0.2) expect(r / (r + g + b)).toBeLessThan(0.8);
      }
    }
  });

  it("treats an unknown tempo as house", () => {
    expect(tempoPalette(0, fresh())).toEqual(tempoPalette(124, fresh()));
  });
});
