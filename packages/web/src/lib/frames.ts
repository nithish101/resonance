/**
 * Feature-frame bus: a ring of seqlock-protected slots (PRD 5.2 output contract, 6.2).
 *
 * Writer: the DSP worker, one frame per hop. Readers: the render worker (and the main-thread
 * fallback renderer). The writer never waits for readers and readers never block the writer.
 *
 * Seqlock protocol, per slot:
 *   writer: seq += 1 (odd = write in progress) -> write payload -> seq += 1 (even)
 *   reader: s1 = seq; if odd retry; copy payload; s2 = seq; if s1 != s2 retry
 * All sequence accesses are `Atomics` operations, which are sequentially consistent in the JS
 * memory model, so the payload copy is bracketed by two synchronizing loads. A racy payload
 * read can observe a mix of old and new bytes, but then `s1 != s2` and the copy is discarded.
 *
 * The same class runs over a non-shared ArrayBuffer in the postMessage fallback (ER-3): the
 * render worker receives frames as messages and writes them into a local bus, so the reader
 * code is identical in both transports.
 *
 * The layout is documented in docs/feature-frame.md and must match `crates/dsp/src/frame.rs`.
 */

export const FRAME_SCHEMA_VERSION = 1;
const MAGIC = 0x52534e43; // "RSNC"

/** Float32 payload fields. Offsets are in floats from the start of the payload. */
export const F = {
  bands: 0, // 6: sub-bass, bass, low-mid, mid, high-mid, treble (0..1, auto-gained)
  mel: 6, // 64: log-mel, 0..1 after auto-gain
  flux: 70, // spectral flux (normalized onset strength, >= 0)
  onset: 71, // 1 on a detected onset, else 0
  bpm: 72, // tempo estimate, 0 when unknown
  tempoConfidence: 73, // 0..1
  beatPhase: 74, // 0..1 within the current beat (P1, 0 until then)
  beat: 75, // 1 on a predicted beat (P1)
  chroma: 76, // 12 pitch classes C..B (P1)
  key: 88, // 0-11 major C..B, 12-23 minor C..B, -1 unknown (P1)
  keyConfidence: 89, // 0..1 (P1)
  centroid: 90, // spectral centroid in Hz
  centroidNorm: 91, // centroid mapped to 0..1 on a log scale
  rms: 92, // linear RMS of the frame, pre-gain
  loudness: 93, // 0..1 auto-gained loudness, 0 when gated
  gate: 94, // 1 when the noise gate is open (signal above the floor), else 0
} as const;
export const FRAME_FLOATS = 112; // 95 used, rest reserved

export const BAND_NAMES = ["sub-bass", "bass", "low-mid", "mid", "high-mid", "treble"] as const;
export const MEL_BANDS = 64;

const HEADER_BYTES = 64;
const H_MAGIC = 0;
const H_VERSION = 1;
const H_SLOTS = 2;
const H_LATEST = 3;
const H_SAMPLE_RATE = 4;
const H_HOP = 5;

/** Slot: [seq i32][pad][frameIndex f64][timestamp f64][pad 8][payload f32 x FRAME_FLOATS] */
const SLOT_META_BYTES = 32;
export const SLOT_BYTES = SLOT_META_BYTES + FRAME_FLOATS * 4;

export interface Frame {
  /** Hop counter since the analyzer started. */
  index: number;
  /**
   * Audio-context frame (sample position) of the centre of the analysis window. Divide by the
   * sample rate for context time in seconds.
   */
  time: number;
  data: Float32Array;
}

export function createFrame(): Frame {
  return { index: -1, time: 0, data: new Float32Array(FRAME_FLOATS) };
}

export function frameBusBytes(slots: number): number {
  return HEADER_BYTES + slots * SLOT_BYTES;
}

export class FrameBus {
  readonly slots: number;
  private readonly header: Int32Array;
  private readonly seq: Int32Array; // one per slot, stride SLOT_BYTES/4
  private readonly f64: Float64Array;
  private readonly f32: Float32Array;

  constructor(readonly buffer: SharedArrayBuffer | ArrayBuffer) {
    this.header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
    this.slots = this.header[H_SLOTS]!;
    if (this.header[H_MAGIC] !== MAGIC) throw new Error("frame bus not initialised");
    if (this.header[H_VERSION] !== FRAME_SCHEMA_VERSION) throw new Error("frame schema mismatch");
    this.seq = new Int32Array(buffer, HEADER_BYTES);
    this.f64 = new Float64Array(buffer, HEADER_BYTES);
    this.f32 = new Float32Array(buffer, HEADER_BYTES);
  }

  static create(slots: number, shared: boolean): FrameBus {
    const bytes = frameBusBytes(slots);
    const buffer = shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    const h = new Int32Array(buffer, 0, HEADER_BYTES / 4);
    h[H_MAGIC] = MAGIC;
    h[H_VERSION] = FRAME_SCHEMA_VERSION;
    h[H_SLOTS] = slots;
    h[H_LATEST] = -1;
    return new FrameBus(buffer);
  }

  setFormat(sampleRate: number, hop: number): void {
    Atomics.store(this.header, H_SAMPLE_RATE, sampleRate);
    Atomics.store(this.header, H_HOP, hop);
  }

  get sampleRate(): number {
    return Atomics.load(this.header, H_SAMPLE_RATE);
  }

  get hop(): number {
    return Atomics.load(this.header, H_HOP);
  }

  /** Index of the newest complete frame, or -1. */
  latest(): number {
    return Atomics.load(this.header, H_LATEST);
  }

  /** Clears the bus (e.g. on source change) so readers don't interpolate across sources. */
  reset(): void {
    Atomics.store(this.header, H_LATEST, -1);
  }

  write(index: number, time: number, payload: Float32Array): void {
    const slot = index % this.slots;
    const base = (slot * SLOT_BYTES) / 4;
    const s = Atomics.add(this.seq, base, 1) + 1; // now odd
    this.f64[base / 2 + 1] = index;
    this.f64[base / 2 + 2] = time;
    this.f32.set(payload.subarray(0, FRAME_FLOATS), base + SLOT_META_BYTES / 4);
    Atomics.store(this.seq, base, s + 1); // even again
    Atomics.store(this.header, H_LATEST, index);
  }

  /**
   * Copies frame `index` into `out`. Returns false if that frame has been overwritten (it's
   * more than `slots` hops old), doesn't exist yet, or stayed torn after a few retries.
   */
  read(index: number, out: Frame): boolean {
    if (index < 0 || index > this.latest()) return false;
    const base = ((index % this.slots) * SLOT_BYTES) / 4;
    for (let attempt = 0; attempt < 4; attempt++) {
      const s1 = Atomics.load(this.seq, base);
      if (s1 & 1) continue;
      const got = this.f64[base / 2 + 1]!;
      const time = this.f64[base / 2 + 2]!;
      out.data.set(this.f32.subarray(base + SLOT_META_BYTES / 4, base + SLOT_BYTES / 4));
      if (Atomics.load(this.seq, base) !== s1) continue;
      if (got !== index) return false;
      out.index = got;
      out.time = time;
      return true;
    }
    return false;
  }
}
