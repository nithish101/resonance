import { describe, expect, it } from "vitest";
import { beatPhaseAt } from "../lib/beats";

describe("beat grid lookup", () => {
  const beats = [1, 1.5, 2, 2.5];
  it("returns phase within the current beat", () => {
    expect(beatPhaseAt(beats, 1.25)).toEqual({ phase: 0.5, index: 0 });
    expect(beatPhaseAt(beats, 2)).toEqual({ phase: 0, index: 2 });
  });
  it("is null outside the grid", () => {
    expect(beatPhaseAt(beats, 0.5)).toBeNull();
    expect(beatPhaseAt(beats, 3)).toBeNull();
    expect(beatPhaseAt([1], 1)).toBeNull();
  });
});
