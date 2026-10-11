// Adaptive quality (RD-10): if frame time exceeds the budget for about a second, step down
// (particle count first, then bloom, then render resolution); step back up after sustained
// headroom.

export interface QualityLevel {
  /** Fraction of the configured particle count. */
  particles: number;
  /** Fraction of device-pixel resolution. */
  scale: number;
  /** Whether the expensive post passes (bloom) may run. */
  post: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { particles: 1, scale: 1, post: true },
  { particles: 0.6, scale: 1, post: true },
  { particles: 0.35, scale: 1, post: true },
  { particles: 0.35, scale: 1, post: false },
  { particles: 0.35, scale: 0.8, post: false },
  { particles: 0.2, scale: 0.65, post: false },
  { particles: 0.1, scale: 0.5, post: false },
];

export interface QualityOptions {
  /** Target frame interval in ms (from the measured display refresh). */
  budgetMs: number;
  /** Over budget for this long -> step down. */
  downAfterMs?: number;
  /** Comfortably under budget for this long -> step up. */
  upAfterMs?: number;
}

export class QualityController {
  level = 0;
  private overMs = 0;
  private underMs = 0;
  private readonly downAfter: number;
  private readonly upAfter: number;

  constructor(
    private budgetMs: number,
    opts: Omit<QualityOptions, "budgetMs"> = {},
  ) {
    this.downAfter = opts.downAfterMs ?? 1000;
    this.upAfter = opts.upAfterMs ?? 4000;
  }

  get current(): QualityLevel {
    return QUALITY_LEVELS[this.level]!;
  }

  setBudget(ms: number): void {
    this.budgetMs = ms;
  }

  /**
   * Feeds one frame. `intervalMs` is the time since the previous frame (what the user sees);
   * `workMs` is the CPU time spent producing it. Returns true when the level changed.
   */
  update(intervalMs: number, workMs: number): boolean {
    // Dropped frames show up as long intervals; heavy frames as high work time.
    const cost = Math.max(intervalMs, workMs);
    if (cost > this.budgetMs * 1.2) {
      this.overMs += intervalMs;
      this.underMs = 0;
    } else if (cost < this.budgetMs * 1.05 && workMs < this.budgetMs * 0.5) {
      this.underMs += intervalMs;
      this.overMs = Math.max(0, this.overMs - intervalMs);
    } else {
      this.underMs = 0;
      this.overMs = Math.max(0, this.overMs - intervalMs / 2);
    }
    if (this.overMs >= this.downAfter && this.level < QUALITY_LEVELS.length - 1) {
      this.level++;
      this.overMs = 0;
      return true;
    }
    if (this.underMs >= this.upAfter && this.level > 0) {
      this.level--;
      this.underMs = 0;
      return true;
    }
    return false;
  }
}

/** Estimates the display refresh interval from rAF timestamps (median of recent deltas). */
export class RefreshEstimator {
  private deltas: number[] = [];
  push(dt: number): void {
    if (dt <= 0 || dt > 100) return;
    this.deltas.push(dt);
    if (this.deltas.length > 120) this.deltas.shift();
  }
  get intervalMs(): number {
    if (this.deltas.length < 10) return 1000 / 60;
    const s = [...this.deltas].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}
