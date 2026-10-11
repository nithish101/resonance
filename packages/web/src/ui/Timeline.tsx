import { useApp } from "../app/store";

/**
 * The track's shape behind the seek bar (IN-5, DSP-9): loudness over time from the offline
 * analysis, with a tick every four beats. Decorative; the seek slider stays the control.
 */
export function Timeline({ duration }: { duration: number }) {
  const t = useApp((s) => s.timeline);
  if (!t || t.status !== "ready" || !duration || t.energy.length < 2) return null;
  const n = t.energy.length;
  const top = t.energy.map((e, i) => `${(i / (n - 1)) * 100},${10 - e * 9}`).join(" ");
  const area = `0,10 ${top} 100,10`;
  const bars = t.beats.filter((_, i) => i % 4 === 0).map((b) => (b / duration) * 100);
  return (
    <svg
      className="timeline"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="timeline"
    >
      <polygon points={area} />
      {bars.map((x, i) => (
        <line key={i} x1={x} x2={x} y1={8.5} y2={10} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
