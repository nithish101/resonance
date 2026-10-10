// Deterministic capture mode (RD-11). Not part of the app bundle: built only for `pnpm capture`
// and the visual tests (RESONANCE_TEST_PAGES=1).
//
//   /capture.html?src=/audio/fixtures/groove-120.wav&mode=tunnel&theme=ember&seed=1&w=1280&h=720&fps=30
//
// 1. Decode the file with an OfflineAudioContext at a fixed 48 kHz and downmix to mono.
// 2. Run the same Rust/WASM analyzer the live app uses over every hop, offline.
// 3. Render on demand at audio times chosen by the caller, at a fixed timestep. No wall clock is
//    involved, so the same file, settings, and seed always produce the same pixels.

import "./capture.css";
import { FRAME_FLOATS, FrameBus } from "../lib/frames";
import { createAnalyzer } from "../workers/analyzer";
import { RenderCore } from "../render/core";
import { FrameReader } from "../render/features";
import { DEFAULT_SETTINGS, type ModeId, type RenderSettings } from "../render/types";
import { WebGL2Backend } from "../render/webgl2/backend";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 2048;
const HOP = 512;

interface CaptureApi {
  duration: number;
  frames: number;
  fps: number;
  /** Advances to `time` (s) in fixed steps from the current position, then draws. */
  renderAt(time: number): void;
  /** Mean luminance (0..1) of the current frame, for the flash-safety test. */
  luminance(): number;
  /** Switches theme ("ember") or mode and theme ("nebula:ember") mid-capture (hero GIF). */
  setTheme(id: string): void;
}

declare global {
  var __capture: Promise<CaptureApi> | undefined;
}

async function setup(): Promise<CaptureApi> {
  const q = new URLSearchParams(location.search);
  const src = q.get("src") ?? "/audio/fixtures/groove-120.wav";
  const width = Number(q.get("w") ?? 1280);
  const height = Number(q.get("h") ?? 720);
  const fps = Number(q.get("fps") ?? 30);
  const settings: RenderSettings = {
    ...DEFAULT_SETTINGS,
    mode: (q.get("mode") as ModeId | null) ?? "tunnel",
    theme: q.get("theme") ?? "ember",
    seed: Number(q.get("seed") ?? 1),
    reducedMotion: q.get("reduced") === "1",
    grain: q.get("grain") !== "0",
  };

  const bytes = await (await fetch(src)).arrayBuffer();
  const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await probe.decodeAudioData(bytes);
  const n = decoded.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i]! += ch[i]! / decoded.numberOfChannels;
  }

  const { analyzer } = await createAnalyzer({
    sampleRate: SAMPLE_RATE,
    frameSize: FRAME_SIZE,
    hop: HOP,
    forceFailure: false,
    forceScalar: q.get("wasm") === "scalar",
  });
  const hops = Math.floor(n / HOP);
  const bus = FrameBus.create(hops + 2, false);
  bus.setFormat(SAMPLE_RATE, HOP);
  const input = analyzer.input();
  const payload = new Float32Array(FRAME_FLOATS);
  for (let h = 0; h < hops; h++) {
    input.set(mono.subarray(h * HOP, (h + 1) * HOP));
    analyzer.process();
    payload.set(analyzer.output());
    // Window centre, as in the live DSP worker.
    bus.write(h, (h + 1) * HOP - FRAME_SIZE / 2, payload);
  }

  const canvas = document.getElementById("c") as HTMLCanvasElement;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const backend = new WebGL2Backend(canvas, { preserveDrawingBuffer: true });
  const core = new RenderCore(backend, new FrameReader(bus), settings);
  core.setFixedSize(width, height);

  let t = -1;
  const step = 1 / fps;
  const gl = canvas.getContext("webgl2")!;
  const px = new Uint8Array(4 * 64 * 64);
  return {
    duration: n / SAMPLE_RATE,
    frames: hops,
    fps,
    renderAt(time: number) {
      if (t < 0) t = Math.max(0, time - 10 * step);
      while (t + step < time - 1e-9) {
        t += step;
        core.renderAt(t, false);
      }
      t = time;
      core.renderAt(time, true);
    },
    setTheme(id: string) {
      const [mode, theme] = id.includes(":") ? id.split(":") : [core.settings.mode, id];
      core.setSettings({ ...core.settings, mode: mode as ModeId, theme: theme! });
    },
    luminance() {
      // Sample a 64x64 grid spread over the frame.
      let sum = 0;
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 8; gx++) {
          const x = Math.floor(((gx + 0.5) / 8) * width) - 4;
          const y = Math.floor(((gy + 0.5) / 8) * height) - 4;
          gl.readPixels(x, y, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
          for (let i = 0; i < 8 * 8 * 4; i += 4) {
            const lin = (v: number) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            };
            sum += 0.2126 * lin(px[i]!) + 0.7152 * lin(px[i + 1]!) + 0.0722 * lin(px[i + 2]!);
          }
        }
      }
      return sum / (64 * 64);
    },
  };
}

globalThis.__capture = setup();
