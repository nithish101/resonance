// Main-thread side of offline analysis (DSP-9). Decodes the file to mono at a reduced rate (to
// bound memory for long tracks: 15 minutes at 22.05 kHz mono is 79 MB, transient), hands it to
// the offline worker, and resolves with the beat grid, key, and energy timeline.

import type { OfflineSummary } from "../workers/offline.worker";

export type { OfflineSummary };

/** Analysis rate: enough for beats and key (Nyquist 11 kHz), and half the memory of 44.1 kHz. */
const RATE = 22_050;

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL("../workers/offline.worker.ts", import.meta.url), {
    type: "module",
  });
  return worker;
}

export async function analyzeFile(bytes: ArrayBuffer, energyPoints = 400): Promise<OfflineSummary> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(bytes);
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels;
  }
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<OfflineSummary & { error?: string }>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ id, samples: mono, sampleRate: RATE, energyPoints }, [mono.buffer]);
  });
}

export { beatPhaseAt } from "../lib/beats";
