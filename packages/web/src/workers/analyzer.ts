// The per-hop analyzer used by the DSP worker: a thin view over the Rust/WASM Analyzer. Samples
// are written directly into WASM memory and the frame is read from it in place.

import { FRAME_FLOATS, FRAME_SCHEMA_VERSION } from "../lib/frames";
import { loadDsp } from "../lib/wasm";

export interface Analyzer {
  readonly sampleRate: number;
  readonly frameSize: number;
  readonly hop: number;
  /** Writable view the caller fills with the next `hop` samples. */
  input(): Float32Array;
  /** Analyses the hop just written to `input()`. */
  process(): void;
  /** The latest feature frame (`FRAME_FLOATS` floats, layout in lib/frames.ts). */
  output(): Float32Array;
  setParams(sensitivity: number, smoothing: number): void;
  reset(): void;
}

export interface AnalyzerOptions {
  sampleRate: number;
  frameSize: number;
  hop: number;
  forceFailure: boolean;
  forceScalar: boolean;
}

export async function createAnalyzer(o: AnalyzerOptions) {
  const dsp = await loadDsp({ forceFailure: o.forceFailure, forceScalar: o.forceScalar });
  const schemaVersion = dsp.module.schemaVersion();
  if (schemaVersion !== FRAME_SCHEMA_VERSION || dsp.module.frameFloats() !== FRAME_FLOATS) {
    throw new Error(`WASM frame schema v${schemaVersion} doesn't match the app`);
  }
  const inner = new dsp.module.Analyzer(o.sampleRate, o.frameSize, o.hop);
  const { memory } = dsp;
  // Views are recreated if memory ever grows (it shouldn't: the analyzer never allocates
  // after construction), because growth detaches the old ArrayBuffer.
  let buffer = memory.buffer;
  const view = () => {
    buffer = memory.buffer;
    return {
      input: new Float32Array(buffer, inner.inputPtr(), o.hop),
      frame: new Float32Array(buffer, inner.framePtr(), FRAME_FLOATS),
    };
  };
  let v = view();
  const fresh = () => (memory.buffer === buffer ? v : (v = view()));
  const analyzer: Analyzer = {
    sampleRate: o.sampleRate,
    frameSize: o.frameSize,
    hop: o.hop,
    input: () => fresh().input,
    process: () => inner.process(),
    output: () => fresh().frame,
    setParams: (s, m) => inner.setParams(s, m),
    reset: () => inner.reset(),
  };
  return { analyzer, simd: dsp.simd, schemaVersion };
}
