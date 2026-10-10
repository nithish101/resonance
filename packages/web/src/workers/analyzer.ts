// The per-hop analyzer used by the DSP worker. Milestone 2 ships a JS stub (RMS only) so the
// audio pipeline can be tested on its own; milestone 3 replaces it with the Rust/WASM analyzer.

import { F, FRAME_FLOATS, FRAME_SCHEMA_VERSION } from "../lib/frames";
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

class StubAnalyzer implements Analyzer {
  private readonly buf: Float32Array;
  private readonly out = new Float32Array(FRAME_FLOATS);
  constructor(
    readonly sampleRate: number,
    readonly frameSize: number,
    readonly hop: number,
  ) {
    this.buf = new Float32Array(hop);
  }
  input() {
    return this.buf;
  }
  process() {
    let s = 0;
    for (let i = 0; i < this.hop; i++) s += this.buf[i]! * this.buf[i]!;
    this.out[F.rms] = Math.sqrt(s / this.hop);
    this.out[F.key] = -1;
  }
  output() {
    return this.out;
  }
  setParams() {}
  reset() {
    this.out.fill(0);
  }
}

export async function createAnalyzer(o: AnalyzerOptions) {
  const dsp = await loadDsp({ forceFailure: o.forceFailure, forceScalar: o.forceScalar });
  return {
    analyzer: new StubAnalyzer(o.sampleRate, o.frameSize, o.hop) as Analyzer,
    simd: dsp.simd,
    schemaVersion: FRAME_SCHEMA_VERSION,
  };
}
