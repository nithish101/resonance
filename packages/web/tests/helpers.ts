import type { Page } from "@playwright/test";

export interface StateSnapshot {
  engine: string;
  source: { kind: string; label: string } | null;
  error: { code: string; title: string } | null;
  silentHint: boolean;
  engineInfo: { transport: string; sampleRate: number; simd: boolean } | null;
  dsp: {
    hops: number;
    rms: number;
    overrunSamples: number;
    dspP95: number;
    centroid: number;
    bands: number[];
    gate: number;
    onsets: number;
    bpm: number;
  } | null;
  playback: { playing: boolean; time: number; duration: number };
}

export function state(page: Page): Promise<StateSnapshot> {
  return page.evaluate(() => {
    const s = (
      globalThis as unknown as { __resonance: { store: { getState(): unknown } } }
    ).__resonance.store.getState();
    return JSON.parse(JSON.stringify(s)) as StateSnapshot;
  });
}

/** 16-bit mono PCM WAV whose header claims `claimedSecs` but carries only `realSecs` of data. */
export function wav(sampleRate: number, realSecs: number, claimedSecs = realSecs): Buffer {
  const n = Math.round(sampleRate * realSecs);
  const claimedBytes = Math.round(sampleRate * claimedSecs) * 2;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + claimedBytes, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(claimedBytes, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), 44 + i * 2);
  }
  return b;
}

/** Mean and standard deviation of luminance over a PNG screenshot (0..255). */
export async function luminanceStats(png: Buffer): Promise<{ mean: number; std: number }> {
  const { PNG } = await import("pngjs");
  const img = PNG.sync.read(png);
  let sum = 0;
  let sq = 0;
  const n = img.width * img.height;
  for (let i = 0; i < img.data.length; i += 4) {
    const y = 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
    sum += y;
    sq += y * y;
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

export interface RenderSnapshot {
  render: { fps: number; quality: number; scale: number } | null;
  renderer: { backend: string | null; location: string | null; reason: string } | null;
}

export function renderState(page: Page): Promise<RenderSnapshot> {
  return page.evaluate(() => {
    const s = (
      globalThis as unknown as { __resonance: { store: { getState(): RenderSnapshot } } }
    ).__resonance.store.getState();
    return JSON.parse(JSON.stringify({ render: s.render, renderer: s.renderer })) as RenderSnapshot;
  });
}
