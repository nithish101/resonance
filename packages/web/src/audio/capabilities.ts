// Capability detection (PRD 6.4, 5.1.1). Runs once at startup; the result drives the fallback
// chain and is shown in the capability banner and debug overlay.

export type RendererKind = "webgpu-worker" | "webgl2-worker" | "webgl2-main" | "none";

export interface Capabilities {
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  audioWorklet: boolean;
  offscreenCanvas: boolean;
  offscreenWebgl2: boolean;
  webgl2: boolean;
  webgpu: boolean;
  /** getDisplayMedia can deliver tab/system audio (Chromium desktop only). */
  tabAudio: boolean;
  mic: boolean;
  reducedMotion: boolean;
}

interface NavigatorUAData {
  brands?: { brand: string }[];
  mobile?: boolean;
}

/** Chromium desktop is the only engine that returns audio from getDisplayMedia (PRD 5.1.1). */
export function canCaptureTabAudio(nav: Navigator = navigator): boolean {
  if (typeof nav.mediaDevices?.getDisplayMedia !== "function") return false;
  const ua = (nav as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (!ua?.brands) return false; // Firefox and Safari don't expose userAgentData
  return !ua.mobile && ua.brands.some((b) => b.brand === "Chromium");
}

function probeOffscreenWebgl2(): boolean {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    return !!new OffscreenCanvas(1, 1).getContext("webgl2");
  } catch {
    return false;
  }
}

function probeWebgl2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated,
    audioWorklet: typeof AudioWorkletNode !== "undefined",
    offscreenCanvas:
      typeof OffscreenCanvas !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function",
    offscreenWebgl2: probeOffscreenWebgl2(),
    webgl2: probeWebgl2(),
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    tabAudio: canCaptureTabAudio(),
    mic: typeof navigator.mediaDevices?.getUserMedia === "function",
    reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  };
}
