// Audio output clock shared from the main thread (which owns the AudioContext) to the renderer
// (PRD 6.3). The main thread samples `AudioContext.getOutputTimestamp()` every animation frame;
// the renderer extrapolates from the latest sample to "now" on its own clock. Both sides use
// `performance.timeOrigin + performance.now()`, which is comparable across threads.
//
// Shared-memory transport: a seqlock-protected Float64Array in a SharedArrayBuffer.
// postMessage transport: the same record is posted to the render worker.

export type ClockMode = 0 | 1 | 2; // 0 idle, 1 file (sync to output), 2 live (min latency)

export interface ClockSample {
  mode: ClockMode;
  sampleRate: number;
  /** Context time (s) of the sample being output by the device at `perfAbs`. */
  contextTime: number;
  /** Absolute wall-clock time (ms since epoch) matching `contextTime`. */
  perfAbs: number;
  /** AudioContext.outputLatency (s), 0 where unsupported. */
  outputLatency: number;
  baseLatency: number;
  /** Seconds the audible output trails the analysis tap (file mode). */
  lookahead: number;
  /** Estimated input-device latency (s) for live sources. */
  inputLatency: number;
  /** Context time (s) the engine is currently processing (currentTime at sample). */
  currentTime: number;
}

const FIELDS = 9;

export function createClockSample(): ClockSample {
  return {
    mode: 0,
    sampleRate: 48_000,
    contextTime: 0,
    perfAbs: 0,
    outputLatency: 0,
    baseLatency: 0,
    lookahead: 0,
    inputLatency: 0,
    currentTime: 0,
  };
}

export class ClockBuffer {
  private readonly seq: Int32Array;
  private readonly f: Float64Array;

  constructor(readonly buffer: SharedArrayBuffer | ArrayBuffer) {
    this.seq = new Int32Array(buffer, 0, 2);
    this.f = new Float64Array(buffer, 8, FIELDS);
  }

  static create(shared: boolean): ClockBuffer {
    const bytes = 8 + FIELDS * 8;
    return new ClockBuffer(shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
  }

  write(s: ClockSample): void {
    const v = Atomics.add(this.seq, 0, 1) + 1;
    const f = this.f;
    f[0] = s.mode;
    f[1] = s.sampleRate;
    f[2] = s.contextTime;
    f[3] = s.perfAbs;
    f[4] = s.outputLatency;
    f[5] = s.baseLatency;
    f[6] = s.lookahead;
    f[7] = s.inputLatency;
    f[8] = s.currentTime;
    Atomics.store(this.seq, 0, v + 1);
  }

  read(out: ClockSample): boolean {
    for (let i = 0; i < 4; i++) {
      const s1 = Atomics.load(this.seq, 0);
      if (s1 & 1) continue;
      const f = this.f;
      out.mode = f[0] as ClockMode;
      out.sampleRate = f[1]!;
      out.contextTime = f[2]!;
      out.perfAbs = f[3]!;
      out.outputLatency = f[4]!;
      out.baseLatency = f[5]!;
      out.lookahead = f[6]!;
      out.inputLatency = f[7]!;
      out.currentTime = f[8]!;
      if (Atomics.load(this.seq, 0) === s1) return true;
    }
    return false;
  }
}

/**
 * Where the renderer should look, given a clock sample and the current absolute time:
 * - file mode: the analysis frame for the sound audible right now, i.e. the output position
 *   minus the lookahead delay (the tap sees each sample `lookahead` seconds before it's heard);
 * - live mode / idle: null, meaning "newest frame".
 * Returns an audio-context sample position.
 */
export function targetFrame(c: ClockSample, nowAbs: number): number | null {
  if (c.mode !== 1 || c.perfAbs === 0) return null;
  const audible = c.contextTime + (nowAbs - c.perfAbs) / 1000;
  return (audible - c.lookahead) * c.sampleRate;
}

/**
 * Live-mode latency estimate (s) from capture to photons for a frame centred at context sample
 * `frameTime`: input device latency + time since that sample was processed + one refresh
 * interval until the frame is on screen.
 */
export function inputLatencyEstimate(
  c: ClockSample,
  nowAbs: number,
  frameTime: number,
  refreshMs: number,
): number {
  // The engine's processing position now: the output position plus the output pipeline delay.
  const audible = c.contextTime + (nowAbs - c.perfAbs) / 1000;
  const processing = audible + c.outputLatency;
  return c.inputLatency + (processing - frameTime / c.sampleRate) + refreshMs / 1000;
}
