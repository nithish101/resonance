/// <reference lib="webworker" />
import { RingConsumer, type RingLayout } from "../audio/shared/ring";

self.onmessage = (
  e: MessageEvent<{ ring: RingLayout; samples: number; consumerDelayMs: number }>,
) => {
  const { ring, samples, consumerDelayMs } = e.data;
  const c = new RingConsumer(ring);
  const dest = new Float32Array(2048);
  let consumed = 0;
  let dropped = 0;
  let corrupt = 0;
  let outOfOrder = 0;
  let lastIndex = -1;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = performance.now() + 30_000;
  while (consumed + dropped < samples && performance.now() < deadline) {
    const r = c.readInto(dest);
    dropped += r.dropped;
    if (r.count === 0) {
      c.wait(5);
      continue;
    }
    if (r.index <= lastIndex) outOfOrder++;
    for (let k = 0; k < r.count; k++) if (dest[k] !== (r.index + k) % (1 << 24)) corrupt++;
    lastIndex = r.index + r.count - 1;
    consumed += r.count;
    if (consumerDelayMs) Atomics.wait(sleeper, 0, 0, consumerDelayMs);
  }
  self.postMessage({ consumed, dropped, corrupt, outOfOrder, overruns: c.overruns });
};
