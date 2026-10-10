/// <reference lib="webworker" />
import { loadDsp } from "../lib/wasm";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ type: "init"; forceFailure?: boolean }>) => {
  if (e.data.type !== "init") return;
  try {
    const dsp = await loadDsp({ forceFailure: e.data.forceFailure ?? false });
    self.postMessage({
      type: "ready",
      schemaVersion: dsp.module.schemaVersion(),
      simd: dsp.simd,
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
