/// <reference lib="webworker" />
// Offline analysis worker (DSP-9): beat grid, key, and energy timeline for a whole file, so the
// seek bar can show the track's shape and the visuals can anticipate beats. Receives mono PCM
// (decoded on the main thread: OfflineAudioContext isn't available in workers).

import { loadDsp } from "../lib/wasm";

declare const self: DedicatedWorkerGlobalScope;

export interface OfflineRequest {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  energyPoints: number;
}

export interface OfflineSummary {
  id: number;
  bpm: number;
  key: number;
  keyConfidence: number;
  /** Beat times in seconds of media time. */
  beats: number[];
  /** Loudness envelope, 0..1, evenly spaced over the track. */
  energy: number[];
  ms: number;
}

const dsp = loadDsp();

self.onmessage = async (e: MessageEvent<OfflineRequest>) => {
  const { id, samples, sampleRate, energyPoints } = e.data;
  try {
    const { module } = await dsp;
    const t0 = performance.now();
    const packed = module.summarizeFile(samples, sampleRate, energyPoints);
    let i = 0;
    const bpm = packed[i++]!;
    const key = packed[i++]!;
    const keyConfidence = packed[i++]!;
    const nBeats = packed[i++]!;
    const beats = Array.from(packed.subarray(i, i + nBeats));
    i += nBeats;
    const nEnergy = packed[i++]!;
    const energy = Array.from(packed.subarray(i, i + nEnergy));
    const out: OfflineSummary = {
      id,
      bpm,
      key,
      keyConfidence,
      beats,
      energy,
      ms: performance.now() - t0,
    };
    self.postMessage(out);
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
