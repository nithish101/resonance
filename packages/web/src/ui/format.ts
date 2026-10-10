export function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PITCHES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

/** 0-11 major C..B, 12-23 minor C..B, anything else unknown. */
export function keyName(k: number): string {
  if (!(k >= 0 && k < 24)) return "—";
  const i = Math.round(k);
  return `${PITCHES[i % 12]} ${i < 12 ? "major" : "minor"}`;
}
