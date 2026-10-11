// Pure helpers for the tap annotation tool (eval/annotations/README.md), unit-tested.

/** Median of (tap - nearest click) over taps within 250 ms of a click: the tapper's latency. */
export function tapLatency(taps: number[], clicks: number[]): number | null {
  const errs: number[] = [];
  for (const t of taps) {
    let best = Infinity;
    for (const c of clicks) if (Math.abs(t - c) < Math.abs(best)) best = t - c;
    if (Math.abs(best) < 0.25) errs.push(best);
  }
  if (errs.length < 8) return null;
  errs.sort((a, b) => a - b);
  return errs[Math.floor(errs.length / 2)]!;
}

/**
 * Merges two tapping passes: each tap in `a` is paired with the nearest unused tap in `b` within
 * `tolerance` seconds; pairs are averaged and corrected for latency. Unpaired taps are dropped,
 * since a beat both passes agree on is far more trustworthy than a single tap.
 */
export function mergePasses(a: number[], b: number[], latency: number, tolerance = 0.1): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const t of a) {
    let bestJ = -1;
    let bestD = tolerance;
    b.forEach((u, j) => {
      const d = Math.abs(u - t);
      if (!used.has(j) && d <= bestD) {
        bestD = d;
        bestJ = j;
      }
    });
    if (bestJ >= 0) {
      used.add(bestJ);
      out.push((t + b[bestJ]!) / 2 - latency);
    }
  }
  return out.sort((x, y) => x - y);
}

export function toBeatsFile(beats: number[]): string {
  return beats.map((t) => t.toFixed(4)).join("\n") + "\n";
}
