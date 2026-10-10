/// <reference lib="webworker" />
import { createAnalyzer } from "../workers/analyzer";

self.onmessage = async (e: MessageEvent<{ mono: Float32Array; scalar: boolean }>) => {
  const { mono, scalar } = e.data;
  const hop = 512;
  const { analyzer, simd } = await createAnalyzer({
    sampleRate: 48_000,
    frameSize: 2048,
    hop,
    forceFailure: false,
    forceScalar: scalar,
  });
  const input = analyzer.input();
  const hops = Math.floor(mono.length / hop);
  // Warm up the JIT and caches with one full pass.
  for (let h = 0; h < hops; h++) {
    input.set(mono.subarray(h * hop, (h + 1) * hop));
    analyzer.process();
  }
  // Per-hop timings (performance.now() is 5 µs resolution when cross-origin isolated), plus
  // batch timings for a precise mean.
  const per: number[] = [];
  const batch = 100;
  let batchTotal = 0;
  let batches = 0;
  for (let pass = 0; pass < 5; pass++) {
    for (let h = 0; h + batch <= hops; h += batch) {
      const t0 = performance.now();
      for (let k = 0; k < batch; k++) {
        input.set(mono.subarray((h + k) * hop, (h + k + 1) * hop));
        const a = performance.now();
        analyzer.process();
        per.push((performance.now() - a) * 1000);
      }
      batchTotal += performance.now() - t0;
      batches++;
    }
  }
  per.sort((a, b) => a - b);
  const q = (p: number) => per[Math.min(per.length - 1, Math.floor(p * per.length))]!;
  self.postMessage({
    simd,
    hops: per.length,
    meanUs: (batchTotal * 1000) / (batches * batch),
    p50Us: q(0.5),
    p95Us: q(0.95),
    p99Us: q(0.99),
    maxUs: per[per.length - 1]!,
    timerResolutionUs: crossOriginIsolated ? 5 : 100,
  });
};
