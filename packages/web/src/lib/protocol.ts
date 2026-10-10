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

/**
 * Switches STFT size. Live sources use a shorter window (lower latency); files keep the longer
 * one (better low-frequency resolution, and the lookahead hides its latency).
 */
export interface DspConfigure {
  type: "configure";
  frameSize: number;
  hop: number;
}

export type DspInbound = DspInit | DspParams | DspConfigure | { type: "reset" };

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
  centroid: number;
  bands: number[];
  loudness: number;
  gate: number;
  /** Onsets detected since the analyzer started. */
  onsets: number;
  /** Per-hop onset strength and onset flags since the previous stats message (debug plot). */
  fluxHistory: number[];
  onsetHistory: number[];
  /** Newest mel spectrum (for the overlay when frames aren't in shared memory). */
  mel: number[];
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
