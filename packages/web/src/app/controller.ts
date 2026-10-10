// Glue between UI actions and the audio engine. Keeps React components free of engine logic.

import { AudioEngine } from "../audio/engine";
import { AppErrorException, appError, toAppError, type AppError } from "../audio/errors";
import { CALIBRATION_TRACK, TRACKS } from "../audio/tracks";
import { ClockBuffer, createClockSample } from "../lib/clock";
import { frameSourceFor, type RenderHost } from "./renderHost";
import { setApp, setPlayback, useApp, type Settings, type SourceInfo } from "./store";

/** Query-string switches used by tests and for forcing fallbacks by hand. */
export const flags = (() => {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  return {
    forcePostMessage: q.get("transport") === "postMessage",
    forceWasmFailure: q.get("wasm") === "fail",
    forceScalar: q.get("wasm") === "scalar",
    /** "main" (main-thread WebGL2) or "webgl2" (skip WebGPU). */
    renderer: q.get("renderer"),
    calibrate: q.get("calibrate") === "1",
  };
})();

/** Seconds of silence on a live source before the hint appears (IN-8). */
const SILENCE_HINT_SECS = 3;
const SILENCE_RMS = 1e-4;

let engine: AudioEngine | null = null;
let renderHost: RenderHost | null = null;

/** Called by the Stage once its renderer exists; connects frames if audio is already running. */
export function registerRenderer(host: RenderHost | null): void {
  renderHost = host;
  if (host && engine) connectRenderer(host, engine);
}

let clockBuffer: ClockBuffer | null = null;
const clockSample = createClockSample();
let clockLoop = 0;

function connectRenderer(host: RenderHost, e: AudioEngine): void {
  host.attach(frameSourceFor(e.frames, e.info.sampleRate, e.info.hop));
  // SharedArrayBuffer isn't even defined on pages that aren't cross-origin isolated.
  if (e.info.transport === "shared-memory" && clockBuffer) {
    host.attachClock(clockBuffer.buffer as SharedArrayBuffer);
  }
}

/**
 * Publishes the audio output clock to the renderer every animation frame (PRD 6.3). Over shared
 * memory it's a seqlocked write; otherwise one small message per frame.
 */
function startClock(e: AudioEngine): void {
  const shared = e.info.transport === "shared-memory";
  clockBuffer = ClockBuffer.create(shared);
  const tick = () => {
    e.sampleClock(clockSample);
    if (shared) clockBuffer!.write(clockSample);
    else renderHost?.pushClock({ ...clockSample });
    clockLoop = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(clockLoop);
  clockLoop = requestAnimationFrame(tick);
}

/** Test hook: luminance stats of the next rendered frame, read back from the GPU. */
export function probeFrame() {
  return renderHost ? renderHost.probe() : Promise.reject(new Error("no renderer"));
}

/** Test hook (RD-12): force a GPU context/device loss; the renderer must recover on its own. */
export function simulateGpuLoss(): void {
  renderHost?.simulateLoss();
}

export function updateSettings(patch: Partial<Settings>): void {
  const settings = { ...useApp.getState().settings, ...patch };
  setApp({ settings });
  renderHost?.setSettings(settings);
  engine?.setDspParams(settings.sensitivity, settings.smoothing);
}
let starting: Promise<AudioEngine> | null = null;
let silentSince = 0;

export function getEngine(): AudioEngine | null {
  return engine;
}

function fail(err: unknown, fallback: Parameters<typeof appError>[0]): void {
  const e: AppError = toAppError(err, fallback);
  setApp({ error: e, busy: false });
}

/** Starts the engine on the first user gesture (ER-1). Safe to call repeatedly. */
export function ensureEngine(): Promise<AudioEngine> {
  if (engine) return Promise.resolve(engine);
  if (starting) return starting;
  setApp({ engine: "starting", error: null });
  starting = AudioEngine.start({
    forcePostMessage: flags.forcePostMessage,
    forceWasmFailure: flags.forceWasmFailure,
    forceScalar: flags.forceScalar,
  })
    .then((e) => {
      engine = e;
      wire(e);
      startClock(e);
      if (renderHost) connectRenderer(renderHost, e);
      setApp({ engine: "ready", engineInfo: e.info });
      return e;
    })
    .catch((err: unknown) => {
      starting = null;
      setApp({ engine: "failed" });
      throw err;
    });
  return starting;
}

function wire(e: AudioEngine): void {
  const m = e.media;
  const sync = () =>
    setPlayback({
      playing: !m.paused,
      time: m.currentTime,
      duration: Number.isFinite(m.duration) ? m.duration : 0,
      loop: m.loop,
    });
  for (const ev of ["play", "pause", "timeupdate", "durationchange", "ended", "seeked"]) {
    m.addEventListener(ev, sync);
  }
  e.setVolume(useApp.getState().playback.volume);
  const { sensitivity, smoothing } = useApp.getState().settings;
  e.setDspParams(sensitivity, smoothing);

  e.onStats = (s) => {
    const { source } = useApp.getState();
    let silentHint = false;
    if (source && (source.kind === "mic" || source.kind === "tab")) {
      if (s.rms < SILENCE_RMS) {
        silentSince ||= performance.now();
        silentHint = performance.now() - silentSince > SILENCE_HINT_SECS * 1000;
      } else silentSince = 0;
    } else silentSince = 0;
    setApp({ dsp: s, silentHint });
  };
  e.onLiveEnded = () => {
    silentSince = 0;
    setApp({ source: null, silentHint: false });
  };
}

async function open(source: SourceInfo, run: (e: AudioEngine) => Promise<void>): Promise<void> {
  setApp({ busy: true, error: null, silentHint: false });
  silentSince = 0;
  try {
    const e = await ensureEngine();
    await run(e);
    setApp({ source, busy: false });
  } catch (err) {
    fail(err, "wasm-failed");
  }
}

export function playTrack(id: string): Promise<void> {
  const t = [...TRACKS, CALIBRATION_TRACK].find((x) => x.id === id);
  if (!t) return Promise.resolve();
  return open({ kind: "track", label: `${t.title} — ${t.artist}`, trackId: t.id }, (e) =>
    e.playUrl(t.url),
  );
}

export function playFile(file: File): Promise<void> {
  return open({ kind: "file", label: file.name }, (e) => e.playFile(file));
}

export function startMic(deviceId?: string, label = "Microphone"): Promise<void> {
  return open({ kind: "mic", label }, (e) => e.startMic(deviceId));
}

export function startTab(): Promise<void> {
  if (!useApp.getState().caps?.tabAudio) {
    setApp({ error: appError("tab-unsupported") });
    return Promise.resolve();
  }
  return open({ kind: "tab", label: "Shared tab" }, (e) => e.startTab());
}

export function stopSource(): void {
  engine?.stop();
  silentSince = 0;
  setApp({ source: null, silentHint: false });
}

export function togglePlay(): void {
  const m = engine?.media;
  if (!m || !useApp.getState().source) return;
  if (m.paused) void engine!.ctx.resume().then(() => m.play());
  else m.pause();
}

export function seek(t: number): void {
  const m = engine?.media;
  if (m && Number.isFinite(m.duration)) m.currentTime = Math.max(0, Math.min(m.duration, t));
}

export function setVolume(v: number): void {
  engine?.setVolume(v);
  setPlayback({ volume: v });
}

export function setLoop(loop: boolean): void {
  if (engine) engine.media.loop = loop;
  setPlayback({ loop });
}

export function dismissError(): void {
  setApp({ error: null });
}

export { AppErrorException };
