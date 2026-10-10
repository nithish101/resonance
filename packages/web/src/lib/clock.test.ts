import { describe, expect, it } from "vitest";
import { ClockBuffer, createClockSample, inputLatencyEstimate, targetFrame } from "./clock";

describe("output clock", () => {
  it("round-trips through the buffer", () => {
    const b = ClockBuffer.create(false);
    const s = {
      ...createClockSample(),
      mode: 1 as const,
      contextTime: 12.5,
      perfAbs: 1000,
      lookahead: 0.1,
    };
    b.write(s);
    const out = createClockSample();
    expect(b.read(out)).toBe(true);
    expect(out).toEqual(s);
  });

  it("targets the analysis frame for what's audible now (file mode)", () => {
    const c = {
      ...createClockSample(),
      mode: 1 as const,
      sampleRate: 48_000,
      contextTime: 10,
      perfAbs: 5000,
      lookahead: 0.1,
    };
    // 250 ms after the sample: audible 10.25 s, minus 0.1 s lookahead.
    expect(targetFrame(c, 5250)).toBeCloseTo(10.15 * 48_000, 6);
  });

  it("uses the newest frame in live mode and when idle", () => {
    expect(targetFrame({ ...createClockSample(), mode: 2, perfAbs: 1 }, 2)).toBeNull();
    expect(targetFrame(createClockSample(), 2)).toBeNull();
  });

  it("estimates live latency from capture to display", () => {
    const c = {
      ...createClockSample(),
      mode: 2 as const,
      sampleRate: 48_000,
      contextTime: 10,
      perfAbs: 0.001,
      outputLatency: 0.02,
      inputLatency: 0.01,
    };
    // Frame centred 30 ms before the processing position; 16.7 ms refresh.
    const processing = 10 + 0.02;
    const frame = (processing - 0.03) * 48_000;
    expect(inputLatencyEstimate(c, 0.001, frame, 16.7)).toBeCloseTo(0.01 + 0.03 + 0.0167, 6);
  });
});
