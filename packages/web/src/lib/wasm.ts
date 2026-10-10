// Loads the DSP WebAssembly module, choosing the SIMD128 build when the engine supports it.

/** Smallest module that uses a SIMD128 instruction (i8x16.splat + i8x16.popcnt). */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

export function supportsWasmSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

export type DspModule = typeof import("../wasm/pkg-simd/dsp.js");

export interface LoadedDsp {
  module: DspModule;
  memory: WebAssembly.Memory;
  simd: boolean;
}

/**
 * Imports and instantiates the DSP module. `forceFailure` exists so e2e tests can exercise the
 * WASM load-failure error state (ER-5).
 */
export async function loadDsp(opts: { forceScalar?: boolean; forceFailure?: boolean } = {}) {
  if (opts.forceFailure) throw new Error("WASM load failure forced for testing (?wasm=fail)");
  const simd = !opts.forceScalar && supportsWasmSimd();
  const module: DspModule = simd
    ? await import("../wasm/pkg-simd/dsp.js")
    : await import("../wasm/pkg-scalar/dsp.js");
  const exports = await module.default();
  return { module, memory: exports.memory, simd } satisfies LoadedDsp;
}
