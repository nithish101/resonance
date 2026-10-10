// Flash limiter (AX-2, WCAG 2.3.1 "Three Flashes or Below Threshold").
//
// WCAG counts a "general flash" as a pair of opposing changes in relative luminance of 10% or
// more of the maximum, and allows no more than three per second. In Resonance the only
// full-frame brightness modulation is the `flash` signal (driven by onsets and, at P1, beats),
// so the limiter works on that signal directly:
//
// - A *flash event* is a rise of the flash signal across `threshold`, the level that produces a
//   10% relative-luminance change. That threshold is checked empirically by measuring frame
//   luminance in capture mode (tests/safety.spec.ts).
// - If three events already happened in the last second, a new rise is capped just below the
//   threshold until the window clears, so it still moves but doesn't count as a flash.
// - Flash colour is never saturated red: the shaders apply flashes as a neutral brightness lift,
//   and palettes keep red saturation below WCAG's "saturated red" definition (R/(R+G+B) >= 0.8).
//
// Time is audio time, so the limiter behaves identically in capture mode.

export const FLASH_THRESHOLD = 0.25;
export const MAX_FLASHES_PER_SEC = 3;

export class FlashLimiter {
  private events: number[] = [];
  private above = false;
  /** Count of rises that were capped, for the debug overlay. */
  suppressed = 0;

  constructor(
    private readonly threshold = FLASH_THRESHOLD,
    private readonly maxPerSec = MAX_FLASHES_PER_SEC,
  ) {}

  reset(): void {
    this.events = [];
    this.above = false;
  }

  /** Returns the flash amount to render at audio time `t` (seconds) for a requested `x`. */
  apply(x: number, t: number): number {
    while (this.events.length && t - this.events[0]! >= 1) this.events.shift();
    if (x < this.threshold) {
      this.above = false;
      return x;
    }
    if (this.above) return x; // still inside an already-counted flash
    if (this.events.length >= this.maxPerSec) {
      this.suppressed++;
      return this.threshold * 0.9;
    }
    this.events.push(t);
    this.above = true;
    return x;
  }
}
