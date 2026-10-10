/// <reference lib="webworker" />
// Render worker (RD-3): owns the OffscreenCanvas and draws without touching the main thread.

import { RenderLoop, rafFor } from "../render/loop";
import type { RenderInbound, RenderOutbound } from "../render/protocol";
import { WebGL2Backend } from "../render/webgl2/backend";

declare const self: DedicatedWorkerGlobalScope;

const post = (m: RenderOutbound) => self.postMessage(m);
let loop: RenderLoop | null = null;

self.onmessage = (e: MessageEvent<RenderInbound>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case "init": {
        const backend = new WebGL2Backend(m.canvas);
        const { raf, cancel } = rafFor(self);
        loop = new RenderLoop(backend, m.settings, raf, cancel, (s) =>
          post({ type: "stats", ...s }),
        );
        loop.resize(m.cssW, m.cssH, m.dpr);
        loop.start();
        post({ type: "ready", backend: backend.kind });
        break;
      }
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
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
