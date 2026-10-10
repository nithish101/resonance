// Messages between the main thread and the render worker.

import type { ClockSample } from "../lib/clock";
import type { RenderStats } from "./core";
import type { BackendKind, RenderSettings } from "./types";

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
    }
  | { type: "attach"; frames: FrameSource }
  | { type: "resize"; cssW: number; cssH: number; dpr: number }
  | { type: "settings"; settings: RenderSettings }
  | { type: "visible"; visible: boolean }
  /** Shared-memory clock: sent once. */
  | { type: "clock"; buffer: SharedArrayBuffer }
  /** postMessage clock: sent every main-thread animation frame. */
  | { type: "clockSample"; sample: ClockSample };

export type RenderOutbound =
  | { type: "ready"; backend: BackendKind }
  | { type: "error"; message: string }
  | ({ type: "stats" } & RenderStats);
