// Concurrency stress harness (PRD 9.1), driven by tests/concurrency.spec.ts. Not shipped: only
// built when RESONANCE_TEST_PAGES=1.
//
// Ring: a producer worker pushes a counting sequence in random-sized chunks while a consumer
// worker reads at a varying pace. The consumer checks every sample it receives equals its stream
// index (so nothing is reordered, duplicated, or torn) and that consumed + dropped == produced.
//
// Frame bus: a writer worker publishes frames whose every float equals the frame index; reader
// workers read as fast as they can. Any accepted frame with mixed values is a torn read.

import { createRing } from "../audio/shared/ring";
import { FrameBus } from "../lib/frames";

type Result = Record<string, number | boolean | string>;

// Workers must be created as `new Worker(new URL(...), ...)` in one expression for Vite to
// bundle them, so callers construct them and pass them in.
function run(w: Worker, msg: unknown): Promise<Result> {
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<Result>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage(msg);
  });
}

async function ringStress(
  samples: number,
  samplesPerSec: number,
  consumerDelayMs: number,
  capacity = 8192,
): Promise<Result> {
  const ring = createRing(capacity, 1024);
  const producer = run(
    new Worker(new URL("./ring-producer.worker.ts", import.meta.url), { type: "module" }),
    { ring, samples, samplesPerSec },
  );
  const consumer = run(
    new Worker(new URL("./ring-consumer.worker.ts", import.meta.url), { type: "module" }),
    {
      ring,
      samples,
      consumerDelayMs,
    },
  );
  const [p, c] = await Promise.all([producer, consumer]);
  return { ...p, ...c };
}

async function busStress(frames: number, readers: number): Promise<Result> {
  const bus = FrameBus.create(8, true);
  const writer = run(
    new Worker(new URL("./bus-writer.worker.ts", import.meta.url), { type: "module" }),
    {
      buffer: bus.buffer,
      frames,
    },
  );
  const rs = Array.from({ length: readers }, () =>
    run(new Worker(new URL("./bus-reader.worker.ts", import.meta.url), { type: "module" }), {
      buffer: bus.buffer,
      frames,
    }),
  );
  const [w, ...r] = await Promise.all([writer, ...rs]);
  return {
    ...w,
    reads: r.reduce((s, x) => s + (x.reads as number), 0),
    torn: r.reduce((s, x) => s + (x.torn as number), 0),
    retriesExhausted: r.reduce((s, x) => s + (x.failed as number), 0),
  };
}

async function main() {
  const results = {
    // 4x real time at 48 kHz, with the app's ring size (32768 samples, 0.68 s at 48 kHz):
    // nothing may be dropped, even with the machine busy running other tests.
    ringPaced: await ringStress(800_000, 192_000, 0, 32768),
    // Unthrottled producer: the consumer can't keep up, so drop-oldest must kick in cleanly.
    ringFlood: await ringStress(4_000_000, 0, 0),
    // Consumer stalls 2 ms per read while the producer floods.
    ringSlow: await ringStress(1_000_000, 0, 2),
    bus: await busStress(200_000, 3),
  };
  (globalThis as unknown as { __stress: unknown }).__stress = results;
  document.getElementById("out")!.textContent = JSON.stringify(results, null, 2);
}

void main();
