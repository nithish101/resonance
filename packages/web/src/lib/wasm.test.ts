import { describe, expect, it } from "vitest";
import { loadDsp, supportsWasmSimd } from "./wasm";

describe("wasm loader", () => {
  it("detects SIMD128 support in the current engine", () => {
    // Node 20+ and every evergreen browser support SIMD128.
    expect(supportsWasmSimd()).toBe(true);
  });

  it("surfaces a forced load failure as a rejected promise (ER-5)", async () => {
    await expect(loadDsp({ forceFailure: true })).rejects.toThrow(/WASM load failure/);
  });
});
