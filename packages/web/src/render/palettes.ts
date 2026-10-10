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

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}
