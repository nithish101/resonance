// Beat-grid lookup shared by the main thread and the render worker.

/**
 * Beat phase (0..1) and the index of the last beat at media time `t` in a sorted beat grid.
 * Returns null outside the grid.
 */
export function beatPhaseAt(beats: number[], t: number): { phase: number; index: number } | null {
  if (beats.length < 2 || t < beats[0]! || t >= beats[beats.length - 1]!) return null;
  let lo = 0;
  let hi = beats.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return { phase: (t - beats[lo]!) / (beats[hi]! - beats[lo]!), index: lo };
}
