import { describe, expect, it } from "vitest";
import { QUALITY_LEVELS, QualityController } from "./quality";

const run = (q: QualityController, ms: number, interval: number, work: number) => {
  let changes = 0;
  for (let t = 0; t < ms; t += interval) if (q.update(interval, work)) changes++;
  return changes;
};

describe("adaptive quality (RD-10)", () => {
  it("holds level 0 while frames fit the budget", () => {
    const q = new QualityController(16.7);
    run(q, 10_000, 16.7, 6);
    expect(q.level).toBe(0);
  });

  it("steps down after about a second over budget, particles before resolution", () => {
    const q = new QualityController(16.7);
    run(q, 900, 33, 30);
    expect(q.level).toBe(0); // not yet a second
    run(q, 300, 33, 30);
    expect(q.level).toBe(1);
    expect(q.current.scale).toBe(1);
    expect(q.current.particles).toBeLessThan(1);
    run(q, 10_000, 33, 30);
    expect(q.level).toBe(QUALITY_LEVELS.length - 1);
    expect(q.current.scale).toBeLessThan(1);
  });

  it("ignores a single hitch", () => {
    const q = new QualityController(16.7);
    run(q, 2000, 16.7, 5);
    q.update(200, 5);
    run(q, 2000, 16.7, 5);
    expect(q.level).toBe(0);
  });

  it("steps back up after sustained headroom", () => {
    const q = new QualityController(16.7);
    run(q, 3000, 40, 35);
    const low = q.level;
    expect(low).toBeGreaterThan(1);
    run(q, 5000, 16.7, 4);
    expect(q.level).toBe(low - 1);
  });

  it("levels never increase in cost as they go down", () => {
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      expect(QUALITY_LEVELS[i]!.particles).toBeLessThanOrEqual(QUALITY_LEVELS[i - 1]!.particles);
      expect(QUALITY_LEVELS[i]!.scale).toBeLessThanOrEqual(QUALITY_LEVELS[i - 1]!.scale);
    }
  });
});
