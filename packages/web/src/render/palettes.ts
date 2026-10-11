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

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}
