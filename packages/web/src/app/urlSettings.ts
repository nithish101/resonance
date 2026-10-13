// Settings shareable through the URL hash (UI-4): #mode=nebula&theme=tide&intensity=0.8...
// Only values that differ from the defaults are written, and anything unknown or out of range
// is ignored, so a hand-edited or stale link can't break the app.

import { DEFAULT_APP_SETTINGS, type Settings } from "./store";
import type { ModeId } from "../render/types";
import { KEY_THEME, PALETTES, TEMPO_THEME } from "../render/palettes";

const MODES: ModeId[] = ["tunnel", "nebula", "bloom"];
const THEMES = [TEMPO_THEME.id, ...PALETTES.map((p) => p.id), KEY_THEME.id];
const NUMBERS: Record<string, [number, number]> = {
  intensity: [0.2, 1],
  sensitivity: [0.5, 2],
  smoothing: [0, 1],
  particles: [10_000, 1_000_000],
};
const BOOLS = ["bloom", "aberration", "grain", "reducedMotion"] as const;

export function encodeSettings(s: Settings): string {
  const q = new URLSearchParams();
  const d = DEFAULT_APP_SETTINGS;
  if (s.mode !== d.mode) q.set("mode", s.mode);
  if (s.theme !== d.theme) q.set("theme", s.theme);
  for (const k of Object.keys(NUMBERS) as (keyof typeof NUMBERS & keyof Settings)[]) {
    const v = s[k] as number;
    if (v !== d[k]) q.set(k, String(Math.round(v * 1000) / 1000));
  }
  for (const k of BOOLS) if (s[k] !== d[k]) q.set(k, s[k] ? "1" : "0");
  return q.toString();
}

export function decodeSettings(hash: string): Partial<Settings> {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Partial<Settings> = {};
  const mode = q.get("mode") as ModeId | null;
  if (mode && MODES.includes(mode)) out.mode = mode;
  const theme = q.get("theme");
  if (theme && THEMES.includes(theme)) out.theme = theme;
  for (const [k, [lo, hi]] of Object.entries(NUMBERS)) {
    const raw = q.get(k);
    const v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v) && v >= lo && v <= hi) (out as Record<string, number>)[k] = v;
  }
  for (const k of BOOLS) {
    const v = q.get(k);
    if (v === "1" || v === "0") out[k] = v === "1";
  }
  return out;
}
