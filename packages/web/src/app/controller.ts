// Glue between UI actions and the audio engine. Keeps React components free of engine logic.

import { AudioEngine } from "../audio/engine";
import { AppErrorException, appError, toAppError, type AppError } from "../audio/errors";
import { TRACKS } from "../audio/tracks";
import { setApp, setPlayback, useApp, type SourceInfo } from "./store";

/** Query-string switches used by tests and for forcing fallbacks by hand. */
export const flags = (() => {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  return {
    forcePostMessage: q.get("transport") === "postMessage",
    forceWasmFailure: q.get("wasm") === "fail",
    forceScalar: q.get("wasm") === "scalar",
    renderer: q.get("renderer"),
  };
})();

/** Seconds of silence on a live source before the hint appears (IN-8). */
const SILENCE_HINT_SECS = 3;
const SILENCE_RMS = 1e-4;

let engine: AudioEngine | null = null;
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
  const t = TRACKS.find((x) => x.id === id);
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
