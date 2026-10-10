// Messages between the main thread and the render worker.

import type { ClockSample } from "../lib/clock";
import type { RenderStats } from "./core";
import type { BackendKind, FrameProbe, RenderSettings } from "./types";

/** How the render side receives feature frames. */
export type FrameSource =
  | { kind: "shared-memory"; buffer: SharedArrayBuffer }
  | { kind: "postMessage"; port: MessagePort; sampleRate: number; hop: number };

export type RenderInbound =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      cssW: number;
      cssH: number;
      dpr: number;
      settings: RenderSettings;
      /** Try WebGPU before WebGL2 (PRD 6.4). */
      preferWebGPU: boolean;
    }
  | { type: "attach"; frames: FrameSource }
  | { type: "resize"; cssW: number; cssH: number; dpr: number }
  | { type: "settings"; settings: RenderSettings }
  | { type: "visible"; visible: boolean }
  /** Shared-memory clock: sent once. */
  | { type: "clock"; buffer: SharedArrayBuffer }
  /** postMessage clock: sent every main-thread animation frame. */
  | { type: "clockSample"; sample: ClockSample }
  /** Test hook: force a GPU context/device loss (RD-12). */
  | { type: "simulate-loss" }
  /** Test hook: luminance stats of the next frame, read back from the GPU. */
  | { type: "probe" };

export type RenderOutbound =
  | { type: "ready"; backend: BackendKind; reason: string }
  | { type: "recovered" }
  | ({ type: "probe" } & FrameProbe)
  | { type: "error"; message: string }
  | ({ type: "stats" } & RenderStats);
