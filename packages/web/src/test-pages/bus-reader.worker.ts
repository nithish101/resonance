/// <reference lib="webworker" />
import { FrameBus, createFrame } from "../lib/frames";

self.onmessage = (e: MessageEvent<{ buffer: SharedArrayBuffer; frames: number }>) => {
  const bus = new FrameBus(e.data.buffer);
  const f = createFrame();
  let reads = 0;
  let torn = 0;
  let failed = 0;
  const deadline = performance.now() + 20_000;
  while (bus.latest() < e.data.frames - 1 && performance.now() < deadline) {
    const want = bus.latest() - (reads % 3); // newest, or one/two behind it
    if (want < 0) continue;
    if (!bus.read(want, f)) {
      failed++;
      continue;
    }
    reads++;
    const v = f.data[0]!;
    if (v !== f.index % (1 << 24) || f.time !== f.index) torn++;
    else
      for (let k = 1; k < f.data.length; k++)
        if (f.data[k] !== v) {
          torn++;
          break;
        }
  }
  self.postMessage({ reads, torn, failed });
};
