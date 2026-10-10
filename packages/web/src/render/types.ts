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
  /** Seconds since the last onset (drives the nebula shockwave); large when none yet. */
  onsetAge: number;
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
