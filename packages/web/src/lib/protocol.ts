// Message shapes between the main thread and the workers.

import type { RingLayout } from "../audio/shared/ring";

export type Transport = "shared-memory" | "postMessage";

export interface DspInit {
  type: "init";
  sampleRate: number;
  /** Shared-memory transport: the PCM ring. */
  ring: RingLayout | null;
  /** postMessage transport: receives `{samples, frame}` batches from the worklet. */
  pcmPort: MessagePort | null;
  /** Shared-memory transport: the frame bus buffer. */
  frameBuffer: SharedArrayBuffer | null;
  /** postMessage transport: frames are posted here for the render side. */
  framePort: MessagePort | null;
  frameSize: number;
  hop: number;
  forceWasmFailure: boolean;
  forceScalar: boolean;
}

export interface DspParams {
  type: "params";
  sensitivity: number;
  smoothing: number;
}

export type DspInbound = DspInit | DspParams | { type: "reset" };

export interface DspStats {
  type: "stats";
  hops: number;
  /** Per-hop analysis time in microseconds over the last stats window. */
  dspP50: number;
  dspP95: number;
  dspMax: number;
  /** Samples dropped by the ring buffer since start. */
  overrunSamples: number;
  /** Peak per-hop RMS over the stats window (linear). */
  rms: number;
  bpm: number;
  key: number;
  /** Newest frame's centre, in audio-context seconds. */
  frameTime: number;
  /** Wall-clock (performance.timeOrigin + now) when that frame was published, ms. */
  framePublishedAt: number;
}

export type DspOutbound =
  | { type: "ready"; simd: boolean; transport: Transport; schemaVersion: number }
  | { type: "error"; message: string }
  | DspStats;

/** A frame posted over the fallback transport. */
export interface FrameMessage {
  index: number;
  time: number;
  data: Float32Array;
}
