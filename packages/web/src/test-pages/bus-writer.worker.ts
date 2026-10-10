/// <reference lib="webworker" />
import { FRAME_FLOATS, FrameBus } from "../lib/frames";

self.onmessage = (e: MessageEvent<{ buffer: SharedArrayBuffer; frames: number }>) => {
  const bus = new FrameBus(e.data.buffer);
  const payload = new Float32Array(FRAME_FLOATS);
  for (let i = 0; i < e.data.frames; i++) {
    payload.fill(i % (1 << 24));
    bus.write(i, i, payload);
  }
  self.postMessage({ written: e.data.frames });
};
