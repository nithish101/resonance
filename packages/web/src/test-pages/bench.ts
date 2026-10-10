// In-browser WASM benchmark (PRD 8: DSP time per hop). Runs the real analyzer, in a worker like
// the app, over a decoded fixture, for both the SIMD and scalar builds. Driven by
// scripts/bench.mjs; built only with RESONANCE_TEST_PAGES=1.

async function run(scalar: boolean) {
  const w = new Worker(new URL("./bench.worker.ts", import.meta.url), { type: "module" });
  const res = await fetch("/audio/fixtures/groove-120.wav");
  const ctx = new OfflineAudioContext(1, 1, 48_000);
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels;
  }
  return new Promise<Record<string, number | boolean>>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<Record<string, number | boolean>>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage({ mono, scalar }, [mono.buffer]);
  });
}

const results = { simd: await run(false), scalar: await run(true) };
(globalThis as unknown as { __bench: unknown }).__bench = results;
document.getElementById("out")!.textContent = JSON.stringify(results, null, 2);
