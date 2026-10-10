// Main-thread side of rendering: picks where and how to render (PRD 6.4 fallback chain), owns
// the <canvas>, forwards size/visibility/settings, and relays stats.

import type { Capabilities } from "../audio/capabilities";
import type { FrameChannel } from "../audio/engine";
import type { RenderStats } from "../render/core";
import { RenderLoop, rafFor } from "../render/loop";
import type { FrameSource, RenderInbound, RenderOutbound } from "../render/protocol";
import type { BackendKind, RenderSettings, RendererLocation } from "../render/types";
import { WebGL2Backend } from "../render/webgl2/backend";

export interface RendererInfo {
  backend: BackendKind | null;
  location: RendererLocation | null;
  /** Why this choice, for the capability banner (UI-5). */
  reason: string;
  error?: string;
}

export interface HostOptions {
  caps: Capabilities;
  settings: RenderSettings;
  /** "main" forces the main-thread fallback (also via ?renderer=main). */
  force?: string | null;
  onStats: (s: RenderStats) => void;
  onInfo: (i: RendererInfo) => void;
}

export class RenderHost {
  private canvas!: HTMLCanvasElement;
  private worker: Worker | null = null;
  private loop: RenderLoop | null = null;
  private resizeObs: ResizeObserver;
  private pendingFrames: FrameSource | null = null;
  private onVisibility = () => this.post({ type: "visible", visible: !document.hidden });

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: HostOptions,
  ) {
    this.resizeObs = new ResizeObserver(() => this.sendSize());
    this.resizeObs.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.start();
  }

  private newCanvas(): HTMLCanvasElement {
    this.canvas?.remove();
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    c.dataset.testid = "stage";
    this.container.appendChild(c);
    this.canvas = c;
    return c;
  }

  private start(): void {
    const { caps, force } = this.opts;
    if (force !== "main" && caps.offscreenCanvas && caps.offscreenWebgl2) {
      this.startWorker();
    } else if (caps.webgl2) {
      this.startMain(
        force === "main"
          ? "Rendering on the main thread (forced)."
          : "OffscreenCanvas WebGL2 isn't available, so rendering runs on the main thread.",
      );
    } else {
      this.opts.onInfo({
        backend: null,
        location: null,
        reason: "WebGL2 isn't available in this browser, so visuals can't be drawn.",
        error: "webgl2-unavailable",
      });
    }
  }

  private startWorker(): void {
    const canvas = this.newCanvas();
    const off = canvas.transferControlToOffscreen();
    const w = new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = w;
    w.onmessage = (e: MessageEvent<RenderOutbound>) => {
      const m = e.data;
      if (m.type === "stats") this.opts.onStats(m);
      else if (m.type === "ready")
        this.opts.onInfo({
          backend: m.backend,
          location: "worker",
          reason: this.opts.caps.webgpu
            ? "WebGL2 in a render worker (WebGPU renderer not enabled yet)."
            : "WebGPU unavailable, using WebGL2 in a render worker.",
        });
      else if (m.type === "error") this.fallBackToMain(m.message);
    };
    w.onerror = (e) => this.fallBackToMain(e.message);
    const [cssW, cssH, dpr] = this.measure();
    const init: RenderInbound = {
      type: "init",
      canvas: off,
      cssW,
      cssH,
      dpr,
      settings: this.opts.settings,
    };
    w.postMessage(init, [off]);
    if (this.pendingFrames) this.attach(this.pendingFrames);
  }

  private fallBackToMain(why: string): void {
    this.worker?.terminate();
    this.worker = null;
    // The transferred canvas can't be reclaimed; startMain creates a fresh one.
    this.startMain(`The render worker failed (${why}), so rendering moved to the main thread.`);
    if (this.pendingFrames) this.attach(this.pendingFrames);
  }

  private startMain(reason: string): void {
    const canvas = this.newCanvas();
    try {
      const backend = new WebGL2Backend(canvas);
      const { raf, cancel } = rafFor(window);
      this.loop = new RenderLoop(backend, this.opts.settings, raf, cancel, this.opts.onStats);
      this.sendSize();
      this.loop.setVisible(!document.hidden);
      this.loop.start();
      this.opts.onInfo({ backend: "webgl2", location: "main", reason });
    } catch (err) {
      this.opts.onInfo({
        backend: null,
        location: null,
        reason: "WebGL2 failed to start, so visuals can't be drawn.",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private measure(): [number, number, number] {
    const r = this.container.getBoundingClientRect();
    return [Math.max(1, r.width), Math.max(1, r.height), window.devicePixelRatio || 1];
  }

  private sendSize(): void {
    const [cssW, cssH, dpr] = this.measure();
    this.post({ type: "resize", cssW, cssH, dpr });
  }

  private post(m: RenderInbound, transfer: Transferable[] = []): void {
    if (this.worker) this.worker.postMessage(m, transfer);
    else if (this.loop) {
      if (m.type === "resize") this.loop.resize(m.cssW, m.cssH, m.dpr);
      else if (m.type === "settings") this.loop.setSettings(m.settings);
      else if (m.type === "visible") this.loop.setVisible(m.visible);
      else if (m.type === "attach") this.loop.attach(m.frames);
    }
  }

  /** Connects the audio engine's feature frames. */
  attach(frames: FrameSource): void {
    this.pendingFrames = frames;
    this.post(
      { type: "attach", frames },
      frames.kind === "postMessage" && this.worker ? [frames.port] : [],
    );
  }

  setSettings(settings: RenderSettings): void {
    this.opts.settings = settings;
    this.post({ type: "settings", settings });
  }

  dispose(): void {
    this.resizeObs.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.worker?.terminate();
    this.loop?.dispose();
    this.canvas?.remove();
  }
}

export function frameSourceFor(f: FrameChannel, sampleRate: number, hop: number): FrameSource {
  return f.kind === "shared-memory"
    ? { kind: "shared-memory", buffer: f.buffer }
    : { kind: "postMessage", port: f.port, sampleRate, hop };
}
