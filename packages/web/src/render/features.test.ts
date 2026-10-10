import { describe, expect, it } from "vitest";
import { F, FRAME_FLOATS, FrameBus } from "../lib/frames";
import { FrameReader, createFeatures } from "./features";

function busWith(times: number[], onsetAt: number[] = []) {
  const bus = FrameBus.create(16, false);
  const p = new Float32Array(FRAME_FLOATS);
  times.forEach((t, i) => {
    p.fill(i * 10);
    p[F.onset] = onsetAt.includes(i) ? 1 : 0;
    p[F.bpm] = 100 + i;
    bus.write(i, t, p);
  });
  return bus;
}

describe("frame reader", () => {
  it("interpolates between the bracketing frames", () => {
    const r = new FrameReader(busWith([0, 512, 1024, 1536]));
    const f = createFeatures();
    r.sample(768, f); // halfway between frames 1 and 2
    expect(f.valid).toBe(true);
    expect(f.data[0]).toBeCloseTo(15);
    expect(f.data[F.bpm]).toBe(102); // discrete: later frame
    expect(f.time).toBe(768);
    expect(f.lead).toBe(1536 - 768);
  });

  it("uses the newest frame when the target is ahead of the analysis", () => {
    const r = new FrameReader(busWith([0, 512, 1024]));
    const f = createFeatures();
    r.sample(5000, f);
    expect(f.data[0]).toBe(20);
    expect(f.lead).toBe(1024 - 5000);
  });

  it("live mode (null target) returns the newest frame", () => {
    const r = new FrameReader(busWith([0, 512, 1024]));
    const f = createFeatures();
    r.sample(null, f);
    expect(f.data[0]).toBe(20);
    expect(f.lead).toBe(0);
  });

  it("reports each onset once, even between rendered frames", () => {
    const r = new FrameReader(busWith([0, 512, 1024, 1536], [1]));
    const f = createFeatures();
    r.sample(1536, f);
    expect(f.onset).toBe(true);
    r.sample(1536, f);
    expect(f.onset).toBe(false);
  });

  it("is invalid before any frame exists", () => {
    const r = new FrameReader(FrameBus.create(8, false));
    const f = createFeatures();
    r.sample(0, f);
    expect(f.valid).toBe(false);
  });
});
