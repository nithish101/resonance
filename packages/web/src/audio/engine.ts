// Main-thread audio engine: owns the AudioContext, the source graph, the AudioWorklet tap, and
// the DSP worker. The main thread only wires things up and handles transport controls; audio
// samples flow audio thread -> DSP worker without touching it (PRD 6.1).
//
// File / bundled track:  <audio> -> MediaElementSource -+-> tap (analysis)
//                                                       +-> delay (lookahead) -> gain -> out
// Mic / tab / system:    MediaStreamSource -> tap (analysis only; never routed to the output)
//
// The lookahead delay lets analysis run ahead of what the listener hears, so the renderer can
// show the frame for the moment that's audible right now (PRD 6.3, docs/latency.md).

import tapUrl from "./worklet/tap.ts?worker&url";
import { createRing, type RingLayout } from "./shared/ring";
import {
  AppErrorException,
  MAX_DURATION_SECS,
  MAX_FILE_BYTES,
  appError,
  micError,
  tabError,
} from "./errors";
import { FrameBus } from "../lib/frames";
import type { DspInit, DspOutbound, DspStats, Transport } from "../lib/protocol";

export type SourceKind = "track" | "file" | "mic" | "tab";

export interface EngineOptions {
  /** Force the postMessage transport even when SharedArrayBuffer is available. */
  forcePostMessage?: boolean;
  forceWasmFailure?: boolean;
  forceScalar?: boolean;
  /** Seconds the audible output trails the analysis in file mode. */
  lookahead?: number;
  frameSize?: number;
  hop?: number;
}

export interface EngineInfo {
  sampleRate: number;
  transport: Transport;
  simd: boolean;
  baseLatency: number;
  outputLatency: number;
}

/** How the render side receives feature frames. */
export type FrameChannel =
  { kind: "shared-memory"; buffer: SharedArrayBuffer } | { kind: "postMessage"; port: MessagePort };

const ACCEPTED_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|mp4|flac|webm)$/i;
const FRAME_SLOTS = 128;
// ~0.75 s at 44.1 kHz. Holds several DSP hops of slack before samples are dropped.
const RING_CAPACITY = 32768;

export class AudioEngine {
  readonly info: EngineInfo;
  readonly frames: FrameChannel;
  readonly media: HTMLAudioElement;
  onStats: ((s: DspStats) => void) | null = null;
  /** A live source ended on its own (the user clicked the browser's "Stop sharing"). */
  onLiveEnded: (() => void) | null = null;

  private mediaNode: MediaElementAudioSourceNode | null = null;
  private streamNode: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private objectUrl: string | null = null;
  private _source: SourceKind | null = null;

  private constructor(
    readonly ctx: AudioContext,
    private readonly tap: AudioWorkletNode,
    private readonly dsp: Worker,
    private readonly delay: DelayNode,
    private readonly gain: GainNode,
    info: EngineInfo,
    frames: FrameChannel,
  ) {
    this.info = info;
    this.frames = frames;
    this.media = new Audio();
    this.media.preload = "auto";
    this.dsp.addEventListener("message", (e: MessageEvent<DspOutbound>) => {
      if (e.data.type === "stats") this.onStats?.(e.data);
    });
  }

  /**
   * Creates the AudioContext and starts the pipeline. Must be called from a user gesture
   * (ER-1): the context is created synchronously, before the first `await`.
   */
  static async start(opts: EngineOptions = {}): Promise<AudioEngine> {
    if (typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new AppErrorException(appError("audio-unavailable"));
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const resumed = ctx.resume();

    const frameSize = opts.frameSize ?? 2048;
    const hop = opts.hop ?? 512;
    const shared =
      !opts.forcePostMessage &&
      globalThis.crossOriginIsolated === true &&
      typeof SharedArrayBuffer !== "undefined";

    await ctx.audioWorklet.addModule(tapUrl);
    const ring: RingLayout | null = shared ? createRing(RING_CAPACITY) : null;
    const tap = new AudioWorkletNode(ctx, "resonance-tap", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { ring, batchSize: 1024 },
    });
    // The tap outputs silence; connecting it to the destination keeps it pulled by the graph.
    tap.connect(ctx.destination);

    const dsp = new Worker(new URL("../workers/dsp.worker.ts", import.meta.url), {
      type: "module",
    });

    let pcmPort: MessagePort | null = null;
    let frames: FrameChannel;
    let frameBuffer: SharedArrayBuffer | null = null;
    let dspFramePort: MessagePort | null = null;
    if (shared) {
      const bus = FrameBus.create(FRAME_SLOTS, true);
      frameBuffer = bus.buffer as SharedArrayBuffer;
      frames = { kind: "shared-memory", buffer: frameBuffer };
    } else {
      // Worklet -> DSP worker directly, and DSP worker -> render side directly.
      const pcm = new MessageChannel();
      tap.port.postMessage({ port: pcm.port1 }, [pcm.port1]);
      pcmPort = pcm.port2;
      const fc = new MessageChannel();
      dspFramePort = fc.port1;
      frames = { kind: "postMessage", port: fc.port2 };
    }

    const ready = new Promise<{ simd: boolean; transport: Transport }>((resolve, reject) => {
      const onMsg = (e: MessageEvent<DspOutbound>) => {
        if (e.data.type === "ready") resolve(e.data);
        else if (e.data.type === "error")
          reject(new AppErrorException(appError("wasm-failed", e.data.message)));
        else return;
        dsp.removeEventListener("message", onMsg);
      };
      dsp.addEventListener("message", onMsg);
      dsp.addEventListener("error", (e) =>
        reject(new AppErrorException(appError("wasm-failed", e.message))),
      );
    });
    const init: DspInit = {
      type: "init",
      sampleRate: ctx.sampleRate,
      ring,
      pcmPort,
      frameBuffer,
      framePort: dspFramePort,
      frameSize,
      hop,
      forceWasmFailure: opts.forceWasmFailure ?? false,
      forceScalar: opts.forceScalar ?? false,
    };
    const transfer: Transferable[] = [];
    if (pcmPort) transfer.push(pcmPort);
    if (dspFramePort) transfer.push(dspFramePort);
    dsp.postMessage(init, transfer);

    let r: { simd: boolean; transport: Transport };
    try {
      r = await ready;
    } catch (e) {
      dsp.terminate();
      void ctx.close();
      throw e;
    }
    await resumed;

    const delay = ctx.createDelay(1);
    delay.delayTime.value = opts.lookahead ?? 0.1;
    const gain = ctx.createGain();
    delay.connect(gain).connect(ctx.destination);

    return new AudioEngine(
      ctx,
      tap,
      dsp,
      delay,
      gain,
      {
        sampleRate: ctx.sampleRate,
        transport: r.transport,
        simd: r.simd,
        baseLatency: ctx.baseLatency ?? 0,
        outputLatency: ctx.outputLatency ?? 0,
      },
      frames,
    );
  }

  get source(): SourceKind | null {
    return this._source;
  }

  get lookahead(): number {
    return this.delay.delayTime.value;
  }

  setLookahead(seconds: number): void {
    this.delay.delayTime.value = seconds;
  }

  setVolume(v: number): void {
    this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  setDspParams(sensitivity: number, smoothing: number): void {
    this.dsp.postMessage({ type: "params", sensitivity, smoothing });
  }

  /** Plays a bundled track (IN-2) through the streaming media element. */
  async playUrl(url: string): Promise<void> {
    await this.loadMedia(url, "track");
  }

  /** Validates and plays a user file (IN-1, IN-6). */
  async playFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) throw new AppErrorException(appError("file-too-large"));
    const typeOk = file.type ? this.media.canPlayType(file.type) !== "" : false;
    if (!typeOk && !ACCEPTED_EXT.test(file.name)) {
      throw new AppErrorException(appError("unsupported-format"));
    }
    const url = URL.createObjectURL(file);
    try {
      await this.loadMedia(url, "file");
      this.objectUrl = url;
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  private async loadMedia(url: string, kind: "track" | "file"): Promise<void> {
    this.stopLive();
    this.resetAnalysis();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    const el = this.media;
    if (!this.mediaNode) {
      // A media element can only ever have one MediaElementSource; create it once.
      this.mediaNode = this.ctx.createMediaElementSource(el);
    }
    this.mediaNode.disconnect();
    this.mediaNode.connect(this.tap);
    this.mediaNode.connect(this.delay);

    await new Promise<void>((resolve, reject) => {
      const done = () => {
        el.removeEventListener("loadedmetadata", onMeta);
        el.removeEventListener("error", onErr);
      };
      const onMeta = () => {
        done();
        if (Number.isFinite(el.duration) && el.duration > MAX_DURATION_SECS) {
          el.removeAttribute("src");
          el.load();
          reject(new AppErrorException(appError("file-too-long")));
        } else resolve();
      };
      const onErr = () => {
        done();
        const code = el.error?.code;
        reject(
          new AppErrorException(
            appError(code === MediaError.MEDIA_ERR_DECODE ? "decode-failed" : "unsupported-format"),
          ),
        );
      };
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("error", onErr);
      el.src = url;
      el.load();
    });
    this._source = kind;
    await this.ctx.resume();
    await el.play();
  }

  /** Microphone or loopback input device (IN-3). Processing that colours the spectrum is off. */
  async startMic(deviceId?: string): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
        },
      });
    } catch (e) {
      throw new AppErrorException(micError(e));
    }
    this.attachLive(stream, "mic");
  }

  /**
   * Another tab or the whole system (IN-4, PRD 5.1.1). The captured audio goes to the tap
   * only: the source tab is still playing it, so routing it to the output would double it.
   */
  async startTab(): Promise<void> {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      throw new AppErrorException(appError("tab-unsupported"));
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Chromium rejects audio-only requests
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
        } as MediaTrackConstraints,
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions);
    } catch (e) {
      throw new AppErrorException(tabError(e));
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    if (stream.getAudioTracks().length === 0) {
      throw new AppErrorException(appError("tab-no-audio"));
    }
    this.attachLive(stream, "tab");
  }

  private attachLive(stream: MediaStream, kind: "mic" | "tab"): void {
    this.media.pause();
    this.mediaNode?.disconnect();
    this.stopLive();
    this.resetAnalysis();
    this.stream = stream;
    this.streamNode = this.ctx.createMediaStreamSource(stream);
    this.streamNode.connect(this.tap);
    this._source = kind;
    for (const t of stream.getAudioTracks()) {
      t.addEventListener("ended", () => {
        if (this.stream === stream) {
          this.stopLive();
          this._source = null;
          this.onLiveEnded?.();
        }
      });
    }
    void this.ctx.resume();
  }

  private stopLive(): void {
    this.streamNode?.disconnect();
    this.streamNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private resetAnalysis(): void {
    this.dsp.postMessage({ type: "reset" });
  }

  /** Stops whatever is playing and returns to idle. */
  stop(): void {
    this.media.pause();
    this.mediaNode?.disconnect();
    this.stopLive();
    this._source = null;
  }

  /** Lists audio inputs. Labels are only populated after mic permission is granted. */
  static async inputDevices(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput");
  }

  async close(): Promise<void> {
    this.stop();
    this.dsp.terminate();
    await this.ctx.close();
  }
}
