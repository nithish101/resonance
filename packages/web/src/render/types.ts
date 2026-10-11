// Renderer interface (RD-1). A backend draws one visual state per call; everything time-varying
// is in the state, which the render core derives from audio time, so the same audio and seed
// always produce the same pixels (RD-11).

import type { Features } from "./features";
import type { Palette } from "./palettes";

/** "calibrate" is the hidden camera-check mode (docs/latency.md), selected with ?calibrate=1. */
export type ModeId = "tunnel" | "nebula" | "bloom" | "calibrate";
export type BackendKind = "webgpu" | "webgl2";
export type RendererLocation = "worker" | "main";

export interface RenderSettings {
  mode: ModeId;
  theme: string;
  /** 0..1 overall motion/brightness intensity. Reduced motion lowers it (AX-3). */
  intensity: number;
  reducedMotion: boolean;
  /** Target particle count for particle modes (scaled down by adaptive quality). */
  particles: number;
  bloom: boolean;
  aberration: boolean;
  grain: boolean;
  seed: number;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  mode: "tunnel",
  theme: "ember",
  intensity: 1,
  reducedMotion: false,
  particles: 200_000,
  bloom: true,
  aberration: true,
  grain: true,
  seed: 1,
};

export interface VisualState {
  /** Audio time in seconds of the moment being shown. */
  time: number;
  /** Audio-time step since the previous frame (0 when paused). */
  dt: number;
  features: Features;
  /** Forward motion integrated over audio time. */
  travel: number;
  /** Onset envelope, 0..1, decaying. */
  pulse: number;
  /** Flash amount after the WCAG flash limiter (AX-2). */
  flash: number;
  /** Smoothed low-frequency energy. */
  bass: number;
  /**
   * Seconds since the last beat, or the last onset when no beats are known (drives the nebula
   * shockwave); large when none yet.
   */
  onsetAge: number;
  /** Beat envelope, 0..1, decaying; 0 when no beats are known. */
  beatPulse: number;
  /** Position within the current beat, 0..1 (from the offline grid or the live tracker). */
  beatPhase: number;
  palette: Palette;
  settings: RenderSettings;
  /** Device-pixel scale after adaptive quality. */
  scale: number;
  particleFraction: number;
}

export interface Backend {
  readonly kind: BackendKind;
  /** Sets the drawing-buffer size in device pixels. */
  resize(width: number, height: number): void;
  draw(state: VisualState): void;
  /** True while the GPU context is lost; draw() is a no-op until restored. */
  readonly lost: boolean;
  /** Test hook (RD-12): force a context/device loss; the backend must recover by itself. */
  simulateLoss(): void;
  /**
   * Test hook: luminance statistics (0..255) of the next drawn frame, read back from the GPU.
   * Independent of the page compositor, which headless browsers don't always use for WebGPU.
   */
  probe(): Promise<FrameProbe>;
  dispose(): void;
}

/**
 * An OffscreenCanvas (render worker) or an HTMLCanvasElement (main-thread fallback), described
 * structurally so this module type-checks in both the DOM and WebWorker environments.
 */
export type AnyCanvas =
  | OffscreenCanvas
  | (EventTarget & {
      width: number;
      height: number;
      getContext(id: "webgl2", options?: WebGLContextAttributes): WebGL2RenderingContext | null;
    });

export interface FrameProbe {
  mean: number;
  std: number;
  /** Fraction of pixels with luminance above 40/255. */
  lit: number;
}

/** Luminance stats over RGBA/BGRA bytes (channel order doesn't change the weights much). */
export function probeBytes(
  px: Uint8Array,
  bgra: boolean,
  stride = 4,
  rowBytes = 0,
  width = 0,
): FrameProbe {
  let sum = 0;
  let sq = 0;
  let lit = 0;
  let n = 0;
  const rows = rowBytes ? Math.floor(px.length / rowBytes) : 1;
  const cols = rowBytes ? width : px.length / stride;
  for (let y = 0; y < rows; y++) {
    const base = y * rowBytes;
    for (let x = 0; x < cols; x++) {
      const i = base + x * stride;
      const r = px[bgra ? i + 2 : i]!;
      const g = px[i + 1]!;
      const b = px[bgra ? i : i + 2]!;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sq += l * l;
      if (l > 40) lit++;
      n++;
    }
  }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), lit: lit / n };
}
