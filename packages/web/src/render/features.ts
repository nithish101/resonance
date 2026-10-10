// Render-side view of the analysis: the feature frame for the target time, interpolated between
// the two frames that bracket it (PRD 6.2), plus event pulses derived from onset/beat flags.

import { F, FRAME_FLOATS, type Frame, FrameBus, MEL_BANDS, createFrame } from "../lib/frames";

export interface Features {
  /** Interpolated frame payload (layout F in lib/frames.ts). */
  data: Float32Array;
  /** Audio-context frame of the moment these features describe. */
  time: number;
  /** Newest analysed frame time minus the target time, in samples (< 0: analysis behind). */
  lead: number;
  /** True if any onset flag was set in frames that became visible since the last sample. */
  onset: boolean;
  /** Newest frame index consumed. */
  index: number;
  valid: boolean;
}

export function createFeatures(): Features {
  return {
    data: new Float32Array(FRAME_FLOATS),
    time: 0,
    lead: 0,
    onset: false,
    index: -1,
    valid: false,
  };
}

/** Reads the frame bus without ever blocking the DSP worker. */
export class FrameReader {
  // Two scratch frames swapped while walking back, plus one for scanning event flags.
  private readonly a: Frame = createFrame();
  private readonly b: Frame = createFrame();
  private probe: Frame = createFrame();
  private lastScanned = -1;

  constructor(private readonly bus: FrameBus) {}

  get sampleRate(): number {
    return this.bus.sampleRate;
  }

  /**
   * Fills `out` with features for audio-context frame `target`, or for the newest frame when
   * `target` is null (live mode: minimum latency). Interpolates linearly between the two frames
   * that bracket the target; never extrapolates past the newest frame.
   */
  sample(target: number | null, out: Features): void {
    out.onset = false;
    let hi = this.a;
    let lo = this.b;
    const latest = this.bus.latest();
    if (latest < 0 || !this.bus.read(latest, hi)) {
      out.valid = false;
      return;
    }
    const t = target ?? hi.time;
    out.lead = hi.time - t;

    // Walk back until `lo` is at or before the target and `hi` is the frame after it.
    let bracketed = false;
    if (t < hi.time) {
      const oldest = Math.max(0, latest - this.bus.slots + 2);
      for (let idx = latest; idx > oldest; idx--) {
        if (!this.bus.read(idx - 1, lo)) break;
        if (lo.time <= t) {
          bracketed = true;
          break;
        }
        [hi, lo] = [lo, hi];
      }
    }

    const d = out.data;
    if (bracketed && hi.time > lo.time) {
      const frac = (t - lo.time) / (hi.time - lo.time);
      for (let i = 0; i < FRAME_FLOATS; i++)
        d[i] = lo.data[i]! + (hi.data[i]! - lo.data[i]!) * frac;
      out.time = t;
    } else {
      d.set(hi.data);
      out.time = hi.time;
    }
    // Discrete fields take the later frame's value rather than a blend.
    d[F.bpm] = hi.data[F.bpm]!;
    d[F.key] = hi.data[F.key]!;
    d[F.gate] = hi.data[F.gate]!;
    out.index = hi.index;
    out.valid = true;

    // Onset flags from every frame that became visible since the last call, up to `hi`.
    const from = Math.max(this.lastScanned + 1, hi.index - this.bus.slots + 2);
    for (let i = from; i <= hi.index; i++) {
      if (this.bus.read(i, this.probe) && this.probe.data[F.onset]! > 0.5) out.onset = true;
    }
    this.lastScanned = Math.max(this.lastScanned, hi.index);
  }

  /** Forget event history (e.g. after a seek or source change). */
  resetEvents(): void {
    this.lastScanned = this.bus.latest();
  }
}

export const melOf = (f: Features, i: number) => f.data[F.mel + Math.min(MEL_BANDS - 1, i)]!;
