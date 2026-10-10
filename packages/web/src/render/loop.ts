// The interactive render loop, shared by the worker and the main-thread fallback.

import { ClockBuffer, createClockSample, targetFrame, type ClockSample } from "../lib/clock";
import { FrameBus } from "../lib/frames";
import type { FrameMessage } from "../lib/protocol";
import { RenderCore, type RenderStats } from "./core";
import { FrameReader } from "./features";
import type { FrameSource } from "./protocol";
import type { Backend, RenderSettings } from "./types";

type RafLike = (cb: (t: number) => void) => number;

export class RenderLoop {
  private core: RenderCore;
  private running = false;
  private visible = true;
  private handle = 0;
  private last = 0;
  private statsTimer: ReturnType<typeof setInterval>;
  private settings: RenderSettings;
  private clock: ClockBuffer = ClockBuffer.create(false);
  private readonly clockSample: ClockSample = createClockSample();

  constructor(
    private readonly backend: Backend,
    settings: RenderSettings,
    private readonly raf: RafLike,
    private readonly cancel: (h: number) => void,
    onStats: (s: RenderStats) => void,
  ) {
    this.settings = settings;
    this.core = new RenderCore(backend, null, settings);
    this.statsTimer = setInterval(() => onStats(this.core.takeStats()), 250);
  }

  /** Connects the feature-frame source once the audio engine exists. */
  attach(src: FrameSource): void {
    let bus: FrameBus;
    if (src.kind === "shared-memory") {
      bus = new FrameBus(src.buffer);
    } else {
      // postMessage fallback (ER-3): mirror frames into a local, non-shared bus so the reader is
      // identical in both transports.
      bus = FrameBus.create(128, false);
      bus.setFormat(src.sampleRate, src.hop);
      src.port.onmessage = (e: MessageEvent<FrameMessage>) =>
        bus.write(e.data.index, e.data.time, e.data.data);
    }
    const core = new RenderCore(this.backend, new FrameReader(bus), this.settings);
    core.resize(...this.size);
    this.core = core;
  }

  private size: [number, number, number] = [1, 1, 1];

  /** Shared-memory output clock from the main thread. */
  attachClock(buffer: SharedArrayBuffer): void {
    this.clock = new ClockBuffer(buffer);
  }

  /** postMessage output clock: one sample per main-thread frame. */
  pushClock(sample: ClockSample): void {
    this.clock.write(sample);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.size = [cssW, cssH, dpr];
    this.core.resize(cssW, cssH, dpr);
  }

  setSettings(s: RenderSettings): void {
    this.settings = s;
    this.core.setSettings(s);
  }

  /** RD-13: stop drawing while the tab is hidden. */
  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.start();
    else this.stop();
  }

  start(): void {
    if (this.running || !this.visible) return;
    this.running = true;
    this.last = 0;
    const tick = (t: number) => {
      if (!this.running) return;
      const interval = this.last ? t - this.last : 0;
      this.last = t;
      const now = performance.timeOrigin + performance.now();
      const c = this.clockSample;
      if (!this.clock.read(c)) c.mode = 0;
      this.core.frame(now, interval, targetFrame(c, now), c);
      this.handle = this.raf(tick);
    };
    this.handle = this.raf(tick);
  }

  stop(): void {
    this.running = false;
    this.cancel(this.handle);
  }

  simulateLoss(): void {
    this.backend.simulateLoss();
  }

  probe() {
    return this.backend.probe();
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    clearInterval(this.statsTimer);
    this.core.dispose();
  }
}

/** requestAnimationFrame where the scope has it (window, and workers in most browsers). */
export function rafFor(scope: {
  requestAnimationFrame?: RafLike;
  cancelAnimationFrame?: (h: number) => void;
}): { raf: RafLike; cancel: (h: number) => void } {
  if (typeof scope.requestAnimationFrame === "function") {
    return {
      raf: scope.requestAnimationFrame.bind(scope),
      cancel: scope.cancelAnimationFrame!.bind(scope),
    };
  }
  return {
    raf: (cb) => setTimeout(() => cb(performance.now()), 1000 / 60) as unknown as number,
    cancel: (h) => clearTimeout(h),
  };
}
