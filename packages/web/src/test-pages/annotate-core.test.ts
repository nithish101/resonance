import { describe, expect, it } from "vitest";
import { mergePasses, tapLatency, toBeatsFile } from "./annotate-core";

describe("tap annotation helpers", () => {
  it("measures tap latency against known clicks", () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5);
    const taps = clicks.map((c, i) => c + 0.03 + (i % 2 ? 0.005 : -0.005));
    expect(tapLatency(taps, clicks)).toBeCloseTo(0.03, 2);
    expect(tapLatency(taps.slice(0, 4), clicks)).toBeNull(); // too few taps
  });

  it("averages agreeing taps from two passes and drops the rest", () => {
    const merged = mergePasses([1.0, 1.5, 2.02, 3.7], [1.02, 1.48, 2.0, 2.5], 0.01);
    expect(merged).toHaveLength(3);
    [1.0, 1.48, 2.0].forEach((x, i) => expect(merged[i]).toBeCloseTo(x, 6));
  });

  it("writes one time per line", () => {
    expect(toBeatsFile([0.5, 1])).toBe("0.5000\n1.0000\n");
  });
});
