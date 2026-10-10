/// <reference lib="webworker" />
import { RingProducer, type RingLayout } from "../audio/shared/ring";

self.onmessage = (
  e: MessageEvent<{ ring: RingLayout; samples: number; samplesPerSec: number }>,
) => {
  const { ring, samples, samplesPerSec } = e.data;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const p = new RingProducer(ring);
  const buf = new Float32Array(ring.margin);
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let produced = 0;
  const t0 = performance.now();
  while (produced < samples) {
    const n = Math.min(samples - produced, 1 + Math.floor(rand() * ring.margin));
    for (let i = 0; i < n; i++) buf[i] = (produced + i) % (1 << 24);
    p.push(buf, 0, n);
    produced += n;
    // Pace to the requested rate (0 = as fast as possible).
    if (samplesPerSec) {
      const ahead = produced / samplesPerSec - (performance.now() - t0) / 1000;
      if (ahead > 0.001) Atomics.wait(sleeper, 0, 0, ahead * 1000);
    }
  }
  self.postMessage({ produced, produceMs: performance.now() - t0 });
};
