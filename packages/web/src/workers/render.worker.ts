/// <reference lib="webworker" />
// Render worker (RD-3): owns the OffscreenCanvas and draws without touching the main thread.

import { RenderLoop, rafFor } from "../render/loop";
import type { RenderInbound, RenderOutbound } from "../render/protocol";
import type { Backend } from "../render/types";
import { WebGL2Backend } from "../render/webgl2/backend";
import { WebGPUBackend } from "../render/webgpu/backend";

declare const self: DedicatedWorkerGlobalScope;

const post = (m: RenderOutbound) => self.postMessage(m);
let loop: RenderLoop | null = null;
let backend: Backend | null = null;

/** WebGPU first when asked, then WebGL2 on the same canvas (PRD 6.4). */
async function createBackend(canvas: OffscreenCanvas, preferWebGPU: boolean) {
  if (preferWebGPU) {
    try {
      const gpu = await WebGPUBackend.create(canvas);
      if (gpu) {
        gpu.onRecovered = () => post({ type: "recovered" });
        // The host reacts to an error by moving rendering to WebGL2 on a fresh canvas.
        gpu.onFatal = (message) =>
          post({ type: "error", message: `WebGPU device lost and not recoverable: ${message}` });
        return {
          backend: gpu as Backend,
          reason: `WebGPU (${gpu.adapterName}) in a render worker.`,
        };
      }
      return {
        backend: new WebGL2Backend(canvas) as Backend,
        reason:
          "WebGPU is present but returned no adapter, so Resonance uses WebGL2 in a render worker.",
      };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return {
        backend: new WebGL2Backend(canvas) as Backend,
        reason: `WebGPU failed to start (${why}), so Resonance uses WebGL2 in a render worker.`,
      };
    }
  }
  return {
    backend: new WebGL2Backend(canvas) as Backend,
    reason: "WebGPU unavailable, using WebGL2 in a render worker.",
  };
}

// Messages that arrive while the backend is still initialising are queued.
let pending: RenderInbound[] | null = [];

async function init(m: Extract<RenderInbound, { type: "init" }>) {
  const created = await createBackend(m.canvas, m.preferWebGPU);
  backend = created.backend;
  const { raf, cancel } = rafFor(self);
  loop = new RenderLoop(backend, m.settings, raf, cancel, (s) => post({ type: "stats", ...s }));
  loop.resize(m.cssW, m.cssH, m.dpr);
  loop.start();
  post({ type: "ready", backend: backend.kind, reason: created.reason });
  const queued = pending ?? [];
  pending = null;
  queued.forEach(handle);
}

self.onmessage = (e: MessageEvent<RenderInbound>) => {
  const m = e.data;
  if (m.type === "init") {
    init(m).catch((err: unknown) =>
      post({ type: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  } else if (pending) {
    pending.push(m);
  } else {
    handle(m);
  }
};

function handle(m: RenderInbound) {
  try {
    switch (m.type) {
      case "init":
        break;
      case "attach":
        loop?.attach(m.frames);
        break;
      case "resize":
        loop?.resize(m.cssW, m.cssH, m.dpr);
        break;
      case "settings":
        loop?.setSettings(m.settings);
        break;
      case "visible":
        loop?.setVisible(m.visible);
        break;
      case "clock":
        loop?.attachClock(m.buffer);
        break;
      case "clockSample":
        loop?.pushClock(m.sample);
        break;
      case "simulate-loss":
        backend?.simulateLoss();
        break;
      case "probe":
        void backend?.probe().then((p) => post({ type: "probe", ...p }));
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
