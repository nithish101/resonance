/// <reference lib="webworker" />
// DSP worker: pulls PCM from the audio thread, runs the Rust/WASM analyzer once per hop, and
// publishes one feature frame per hop to the frame bus (PRD 6.1).

import { RingConsumer } from "../audio/shared/ring";
import { F, FRAME_FLOATS, FrameBus } from "../lib/frames";
import { Window, wallNow } from "../lib/stats";
import { createAnalyzer, type Analyzer } from "./analyzer";
import type { DspInbound, DspInit, DspOutbound, FrameMessage } from "../lib/protocol";

declare const self: DedicatedWorkerGlobalScope;

const post = (m: DspOutbound) => self.postMessage(m);

let analyzer: Analyzer | null = null;
let consumer: RingConsumer | null = null;
let bus: FrameBus | null = null;
let framePort: MessagePort | null = null;

/** Samples accumulated toward the next hop. */
let fill = 0;
let hopIndex = 0;
/** Audio-context frame of the sample right after the last one fed to the analyzer. */
let nextFrame = 0;
let latestTime = 0;
let latestPublishedAt = 0;

const dspTimes = new Window(512);
/** Peak per-hop RMS since the last stats message, so short transients aren't missed. */
let rmsPeak = 0;
let pending: { samples: Float32Array; frame: number }[] = [];
const scratch = new Float32Array(4096);

function feed(samples: Float32Array, count: number, firstFrame: number): void {
  const a = analyzer;
  if (!a) return;
  const input = a.input();
  let i = 0;
  while (i < count) {
    const take = Math.min(a.hop - fill, count - i);
    input.set(samples.subarray(i, i + take), fill);
    fill += take;
    i += take;
    if (fill === a.hop) {
      fill = 0;
      nextFrame = firstFrame + i;
      runHop(a);
    }
  }
  nextFrame = firstFrame + count;
}

function runHop(a: Analyzer): void {
  const t0 = performance.now();
  a.process();
  dspTimes.push((performance.now() - t0) * 1000);
  const out = a.output();
  rmsPeak = Math.max(rmsPeak, out[F.rms]!);
  // The window ends at `nextFrame`; its centre is half a frame earlier.
  const time = nextFrame - a.frameSize / 2;
  if (bus) bus.write(hopIndex, time, out);
  if (framePort) {
    const msg: FrameMessage = { index: hopIndex, time, data: out.slice(0, FRAME_FLOATS) };
    framePort.postMessage(msg, [msg.data.buffer]);
  }
  latestTime = time;
  latestPublishedAt = wallNow();
  hopIndex++;
}

function pump(): void {
  if (consumer) {
    if (!consumer.started) return;
    for (;;) {
      const r = consumer.readInto(scratch);
      if (r.count === 0) break;
      feed(scratch, r.count, consumer.firstFrame + r.index);
    }
  } else if (pending.length) {
    const batches = pending;
    pending = [];
    for (const b of batches) feed(b.samples, b.samples.length, b.frame);
  }
}

function schedule(): void {
  // Wake when the producer publishes (Atomics.waitAsync) or fall back to a short poll.
  type WaitAsync = (
    a: Int32Array,
    i: number,
    v: number,
    t: number,
  ) => { async: boolean; value: Promise<unknown> | string };
  const waitAsync = (Atomics as unknown as { waitAsync?: WaitAsync }).waitAsync;
  const header = consumer ? consumer.writeIndexView : null;
  const loop = () => {
    pump();
    if (header && waitAsync) {
      const r = waitAsync(header, 0, Atomics.load(header, 0), 20);
      if (r.async) void (r.value as Promise<unknown>).then(loop);
      else setTimeout(loop, 0);
    } else {
      setTimeout(loop, 3);
    }
  };
  loop();
}

function sendStats(): void {
  const a = analyzer;
  if (!a) return;
  const out = a.output();
  post({
    type: "stats",
    hops: hopIndex,
    dspP50: dspTimes.percentile(0.5),
    dspP95: dspTimes.percentile(0.95),
    dspMax: dspTimes.max(),
    overrunSamples: consumer?.overruns ?? 0,
    rms: rmsPeak,
    bpm: out[F.bpm]!,
    key: out[F.key]!,
    frameTime: latestTime / a.sampleRate,
    framePublishedAt: latestPublishedAt,
  });
  rmsPeak = 0;
}

async function init(m: DspInit): Promise<void> {
  try {
    const loaded = await createAnalyzer({
      sampleRate: m.sampleRate,
      frameSize: m.frameSize,
      hop: m.hop,
      forceFailure: m.forceWasmFailure,
      forceScalar: m.forceScalar,
    });
    analyzer = loaded.analyzer;
    if (m.ring) consumer = new RingConsumer(m.ring);
    if (m.frameBuffer) {
      bus = new FrameBus(m.frameBuffer);
      bus.setFormat(m.sampleRate, m.hop);
    }
    framePort = m.framePort;
    if (m.pcmPort) {
      m.pcmPort.onmessage = (e: MessageEvent<{ samples: Float32Array; frame: number }>) => {
        pending.push(e.data);
      };
    }
    schedule();
    setInterval(sendStats, 250);
    post({
      type: "ready",
      simd: loaded.simd,
      transport: m.ring ? "shared-memory" : "postMessage",
      schemaVersion: loaded.schemaVersion,
    });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<DspInbound>) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      void init(m);
      break;
    case "params":
      analyzer?.setParams(m.sensitivity, m.smoothing);
      break;
    case "reset":
      analyzer?.reset();
      bus?.reset();
      fill = 0;
      dspTimes.clear();
      break;
  }
};
