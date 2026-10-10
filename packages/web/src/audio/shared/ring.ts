/**
 * Single-producer / single-consumer PCM ring buffer on a SharedArrayBuffer (PRD 6.2).
 *
 * Producer: the AudioWorklet (audio thread). Consumer: the DSP worker.
 *
 * Each side owns exactly one index. The producer writes samples, then publishes `write` with
 * `Atomics.store`. The consumer publishes `read` the same way. The producer never waits and
 * never looks at `read`: when the consumer falls behind, the producer simply overwrites the
 * oldest samples. The consumer detects that ("drop oldest") in two places:
 *
 * 1. Before copying, if more than `capacity - margin` samples are pending, it skips ahead to the
 *    newest `capacity - margin` samples.
 * 2. After copying, it re-reads `write`. Any copied sample the producer could have overwritten
 *    meanwhile (including the chunk it may be writing right now, up to `margin` samples) is
 *    discarded, because the copy may be torn.
 *
 * Both cases add to the overrun counter shown in the debug overlay. Indices are 32-bit counters
 * that wrap; all differences use unsigned 32-bit arithmetic, which is correct as long as fewer
 * than 2^31 samples are ever pending (about 12 hours at 48 kHz).
 *
 * Sample `n` in the stream (counting from the first sample ever written) was captured at audio
 * context frame `startFrame + n`. The producer writes every render quantum, silent or not, so
 * this mapping never drifts.
 */

const HEADER_BYTES = 128;
const I_WRITE = 0;
const I_READ = 1;
const I_OVERRUNS = 2;
const I_STARTED = 3;
/** Byte offset of the Float64 start frame inside the header. */
const START_FRAME_BYTE = 64;

/** Largest number of samples the producer writes in one call. */
export const DEFAULT_MARGIN = 1024;

export interface RingLayout {
  sab: SharedArrayBuffer;
  capacity: number;
  margin: number;
}

export function createRing(capacity: number, margin = DEFAULT_MARGIN): RingLayout {
  if (!Number.isInteger(Math.log2(capacity))) throw new Error("capacity must be a power of two");
  if (margin * 4 > capacity) throw new Error("capacity must be at least 4x the margin");
  const sab = new SharedArrayBuffer(HEADER_BYTES + capacity * 4);
  return { sab, capacity, margin };
}

const u32 = (x: number) => x >>> 0;

export class RingProducer {
  private readonly header: Int32Array;
  private readonly data: Float32Array;
  private readonly startFrame: Float64Array;
  private readonly mask: number;
  private write: number;

  constructor(private readonly layout: RingLayout) {
    this.header = new Int32Array(layout.sab, 0, HEADER_BYTES / 4);
    this.startFrame = new Float64Array(layout.sab, START_FRAME_BYTE, 1);
    this.data = new Float32Array(layout.sab, HEADER_BYTES, layout.capacity);
    this.mask = layout.capacity - 1;
    this.write = u32(Atomics.load(this.header, I_WRITE));
  }

  /**
   * Appends samples. `frame` is the audio-context frame of `samples[0]`; it's recorded once, on
   * the first write. Never blocks and never allocates.
   */
  push(samples: Float32Array, frame: number, length = samples.length): void {
    if (length > this.layout.margin) throw new Error("chunk larger than ring margin");
    if (Atomics.load(this.header, I_STARTED) === 0) {
      this.startFrame[0] = frame;
      Atomics.store(this.header, I_STARTED, 1);
    }
    const w = this.write;
    for (let i = 0; i < length; i++) this.data[(w + i) & this.mask] = samples[i]!;
    this.write = u32(w + length);
    Atomics.store(this.header, I_WRITE, this.write | 0);
    Atomics.notify(this.header, I_WRITE);
  }
}

export interface ReadResult {
  /** Number of valid samples copied into `dest`. */
  count: number;
  /** Stream index (samples since the first write) of `dest[0]`. */
  index: number;
  /** Samples dropped (overwritten before they could be read) during this call. */
  dropped: number;
}

export class RingConsumer {
  private readonly header: Int32Array;
  private readonly data: Float32Array;
  private readonly startFrame: Float64Array;
  private readonly mask: number;
  private read: number;
  /** Absolute stream index of `read`, as a float64 so it never wraps. */
  private absolute = 0;

  constructor(private readonly layout: RingLayout) {
    this.header = new Int32Array(layout.sab, 0, HEADER_BYTES / 4);
    this.startFrame = new Float64Array(layout.sab, START_FRAME_BYTE, 1);
    this.data = new Float32Array(layout.sab, HEADER_BYTES, layout.capacity);
    this.mask = layout.capacity - 1;
    this.read = u32(Atomics.load(this.header, I_READ));
  }

  /** Int32 view whose element 0 is the write index, for `Atomics.waitAsync`. */
  get writeIndexView(): Int32Array {
    return this.header;
  }

  /** True once the producer has written anything (so `startFrame` is valid). */
  get started(): boolean {
    return Atomics.load(this.header, I_STARTED) === 1;
  }

  /** Audio-context frame of stream index 0. Only valid once `started`. */
  get firstFrame(): number {
    return this.startFrame[0]!;
  }

  get overruns(): number {
    return u32(Atomics.load(this.header, I_OVERRUNS));
  }

  /** Samples currently waiting to be read. */
  available(): number {
    return u32(u32(Atomics.load(this.header, I_WRITE)) - this.read);
  }

  /**
   * Waits (in a worker) until at least one sample is pending or `timeoutMs` passes. Must not be
   * called on the main thread or the audio thread.
   */
  wait(timeoutMs: number): void {
    const w = Atomics.load(this.header, I_WRITE);
    if (u32(w) === this.read) Atomics.wait(this.header, I_WRITE, w, timeoutMs);
  }

  /** Copies up to `dest.length` of the oldest still-valid samples into `dest`. */
  readInto(dest: Float32Array): ReadResult {
    const { capacity, margin } = this.layout;
    const limit = capacity - margin;
    let dropped = 0;

    let w = u32(Atomics.load(this.header, I_WRITE));
    let pending = u32(w - this.read);
    if (pending > limit) {
      dropped += pending - limit;
      this.advance(pending - limit);
      pending = limit;
    }

    const n = Math.min(pending, dest.length);
    const r = this.read;
    for (let i = 0; i < n; i++) dest[i] = this.data[(r + i) & this.mask]!;

    // Validate: anything older than `w2 - limit` may have been overwritten during the copy.
    w = u32(Atomics.load(this.header, I_WRITE));
    const behind = u32(w - r);
    let skip = 0;
    if (behind > limit) skip = Math.min(n, behind - limit);
    if (skip > 0) {
      dest.copyWithin(0, skip, n);
      dropped += skip;
    }
    const index = this.absolute + skip;
    this.advance(n);
    if (dropped > 0) Atomics.add(this.header, I_OVERRUNS, dropped);
    return { count: n - skip, index, dropped };
  }

  private advance(n: number): void {
    this.read = u32(this.read + n);
    this.absolute += n;
    Atomics.store(this.header, I_READ, this.read | 0);
  }
}
