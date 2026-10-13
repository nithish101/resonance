// Colour themes. Each is a cosine palette c(t) = a + b·cos(2π(c·t + d)) (Iñigo Quilez), which
// gives smooth, saturated-but-controlled gradients from four vec3s.

export interface Palette {
  id: string;
  name: string;
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

export const PALETTES: readonly Palette[] = [
  {
    id: "ember",
    name: "Ember",
    a: [0.55, 0.38, 0.3],
    b: [0.45, 0.32, 0.26],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.08, 0.18],
  },
  {
    id: "tide",
    name: "Tide",
    a: [0.25, 0.42, 0.5],
    b: [0.25, 0.32, 0.38],
    c: [1.0, 1.0, 1.0],
    d: [0.55, 0.62, 0.72],
  },
  {
    id: "aurora",
    name: "Aurora",
    a: [0.42, 0.5, 0.45],
    b: [0.4, 0.4, 0.35],
    c: [1.0, 1.0, 0.8],
    d: [0.3, 0.55, 0.75],
  },
  {
    id: "mono",
    name: "Monochrome",
    a: [0.5, 0.5, 0.5],
    b: [0.42, 0.42, 0.42],
    c: [1.0, 1.0, 1.0],
    d: [0.0, 0.0, 0.0],
  },
];

/**
 * The "Key" theme (DSP-8): the detected key picks the palette. Keys a fifth apart get adjacent
 * hues (circle of fifths), so related keys look related; minor keys are darker and cooler.
 */
export const KEY_THEME: Palette = {
  id: "key",
  name: "Follow the key",
  a: [0.5, 0.45, 0.42],
  b: [0.4, 0.36, 0.34],
  c: [1, 1, 1],
  d: [0, 0.1, 0.2],
};

export function keyPalette(key: number): Palette {
  if (!(key >= 0 && key < 24)) return PALETTES[0]!;
  const tonic = Math.round(key) % 12;
  const minor = key >= 12;
  const hue = ((tonic * 7) % 12) / 12; // position on the circle of fifths
  const a: [number, number, number] = minor ? [0.36, 0.38, 0.45] : [0.52, 0.46, 0.4];
  const b: [number, number, number] = minor ? [0.3, 0.32, 0.38] : [0.42, 0.38, 0.32];
  return { ...KEY_THEME, a, b, d: [hue, hue + 0.12, hue + 0.24] };
}

/**
 * The "Follow the tempo" theme: the palette drifts with the song's BPM. Slow material is deep
 * blue and teal, house tempos (about 118-130) are warm amber and rose, and fast tracks move to
 * violet and magenta. Never saturated red, which the flash-safety rules avoid (AX-2).
 */
export const TEMPO_THEME: Palette = {
  id: "tempo",
  name: "Follow the tempo",
  a: [0.5, 0.42, 0.4],
  b: [0.42, 0.34, 0.3],
  c: [1, 1, 1],
  d: [0, 0.1, 0.2],
};

/** Anchor palettes by BPM; colours are interpolated between neighbours. */
const TEMPO_ANCHORS: { bpm: number; a: Vec3; b: Vec3; d: Vec3 }[] = [
  { bpm: 80, a: [0.22, 0.36, 0.5], b: [0.2, 0.3, 0.38], d: [0.55, 0.62, 0.72] },
  { bpm: 105, a: [0.3, 0.45, 0.45], b: [0.28, 0.36, 0.34], d: [0.4, 0.55, 0.65] },
  { bpm: 124, a: [0.55, 0.38, 0.3], b: [0.45, 0.32, 0.26], d: [0.0, 0.08, 0.18] },
  { bpm: 140, a: [0.48, 0.34, 0.44], b: [0.38, 0.3, 0.36], d: [-0.1, 0.05, 0.2] },
  { bpm: 165, a: [0.42, 0.32, 0.55], b: [0.34, 0.28, 0.42], d: [-0.25, -0.1, 0.05] },
];
// Phases (d) are written as continuous values (-0.1 rather than 0.9) so interpolation takes the
// short way round the colour wheel instead of sweeping through every hue.
type Vec3 = [number, number, number];

const lerp3 = (x: Vec3, y: Vec3, t: number, out: Vec3): Vec3 => {
  for (let i = 0; i < 3; i++) out[i] = x[i]! + (y[i]! - x[i]!) * t;
  return out;
};

/**
 * Writes the palette for `bpm` into `out` (no allocation; called every frame). A bpm of 0
 * (unknown) is treated as a mid-house 124.
 */
export function tempoPalette(bpm: number, out: Palette): Palette {
  const b = bpm > 0 ? Math.min(180, Math.max(60, bpm)) : 124;
  let i = 0;
  while (i < TEMPO_ANCHORS.length - 2 && b > TEMPO_ANCHORS[i + 1]!.bpm) i++;
  const lo = TEMPO_ANCHORS[i]!;
  const hi = TEMPO_ANCHORS[i + 1]!;
  const t = Math.min(1, Math.max(0, (b - lo.bpm) / (hi.bpm - lo.bpm)));
  lerp3(lo.a, hi.a, t, out.a);
  lerp3(lo.b, hi.b, t, out.b);
  lerp3(lo.d, hi.d, t, out.d);
  out.c[0] = out.c[1] = out.c[2] = 1;
  return out;
}

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}
