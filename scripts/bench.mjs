// `pnpm bench`: measures every PRD section 8 metric this machine can measure and writes
// docs/benchmarks.md (and docs/benchmarks.json). Nothing in that file is typed by hand.
//
//   node scripts/bench.mjs                 # 60 s render run
//   node scripts/bench.mjs --soak=600      # also a 10-minute playback soak (overruns, memory)
//
// Browser measurements use headless Chromium with ANGLE on Metal, i.e. the machine's real GPU,
// and Chromium's fake audio output (timer-driven, silent).

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAndServe, requireWeb, root } from "./lib/serve.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const RUN_SECS = Number(args.duration ?? 60);
const SOAK_SECS = Number(args.soak ?? 0);
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const log = (...m) => console.log("[bench]", ...m);

// ---------------------------------------------------------------- environment
const env = {
  date: new Date().toISOString().slice(0, 10),
  cpu: sh("sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m"),
  memoryGB: Math.round(Number(sh("sysctl -n hw.memsize 2>/dev/null || echo 0")) / 2 ** 30),
  os: sh(
    "sw_vers -productName 2>/dev/null && sw_vers -productVersion 2>/dev/null || uname -sr",
  ).replace(/\n/g, " "),
  node: process.version,
  rustc: sh("rustc --version"),
};

// ---------------------------------------------------------------- native criterion
log("criterion (native)…");
execFileSync(
  "cargo",
  [
    "bench",
    "-p",
    "resonance-dsp",
    "--bench",
    "dsp",
    "--",
    "--warm-up-time",
    "1",
    "--measurement-time",
    "3",
  ],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);
const crit = (path) => {
  const f = join(root, "target/criterion", path, "new/estimates.json");
  if (!existsSync(f)) return null;
  const e = JSON.parse(readFileSync(f, "utf8"));
  return e.median.point_estimate / 1000; // ns -> µs
};
const native = {
  fft: [512, 1024, 2048, 4096].map((n) => ({
    n,
    ours: crit(`complex_fft/resonance/${n}`),
    rustfft: crit(`complex_fft/rustfft/${n}`),
  })),
  realFft: [1024, 2048, 4096].map((n) => ({ n, ours: crit(`real_fft/resonance/${n}`) })),
  hop: crit("analyzer_hop_2048_512"),
};

// ---------------------------------------------------------------- bundle size
log("production build + bundle size…");
execFileSync("pnpm", ["exec", "vite", "build"], {
  cwd: join(root, "packages/web"),
  stdio: "ignore",
});
const size = JSON.parse(
  execFileSync("node", ["scripts/size-budget.mjs", "--json"], { cwd: root, encoding: "utf8" }),
);

// ---------------------------------------------------------------- lighthouse
log("Lighthouse CI…");
let lighthouse = null;
try {
  const chrome = execFileSync("node", ["scripts/chrome-path.mjs"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  execSync("rm -rf .lighthouseci && pnpm exec lhci autorun", {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, CHROME_PATH: chrome },
  });
  const dir = join(root, ".lighthouseci/reports");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const rep = manifest.find((m) => m.isRepresentativeRun) ?? manifest[0];
  const r = JSON.parse(readFileSync(rep.jsonPath, "utf8"));
  lighthouse = {
    version: r.lighthouseVersion,
    performance: Math.round(r.categories.performance.score * 100),
    accessibility: Math.round(r.categories.accessibility.score * 100),
    bestPractices: Math.round(r.categories["best-practices"].score * 100),
    fcp: r.audits["first-contentful-paint"].numericValue,
    lcp: r.audits["largest-contentful-paint"].numericValue,
    tbt: r.audits["total-blocking-time"].numericValue,
    runs: manifest.length,
  };
  void readdirSync;
} catch (e) {
  log("Lighthouse failed:", e.message);
}

// ---------------------------------------------------------------- browser runs
const server = await buildAndServe(4180);
const { chromium } = requireWeb("@playwright/test");
const gpuArgs = [
  "--use-angle=metal",
  "--ignore-gpu-blocklist",
  "--disable-audio-output",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  // measureUserAgentSpecificMemory resolves at the next GC; this makes it resolve promptly.
  "--enable-blink-features=ForceEagerMeasureMemory",
];
// Full Chromium in new-headless mode: unlike the headless shell it exposes
// performance.measureUserAgentSpecificMemory (and WebGPU on the real GPU).
const browser = await chromium.launch({
  channel: "chromium",
  args: process.platform === "darwin" ? gpuArgs : gpuArgs.slice(1),
});
const browserVersion = browser.version();

async function appPage(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("resonance.photosensitivity-ack.v1", "1");
    // Count main-thread long tasks (> 50 ms) from the very start.
    globalThis.__longtasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          globalThis.__longtasks.push({ t: e.startTime, d: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // unsupported
    }
  });
  const page = await ctx.newPage();
  await page.goto(server.url);
  return { ctx, page };
}

// 1. WASM DSP per hop, in a worker, SIMD and scalar.
log("WASM DSP per hop…");
let wasm;
{
  const page = await browser.newPage();
  await page.goto(`${server.url}/bench.html`);
  wasm = await (
    await page.waitForFunction(() => globalThis.__bench, null, { timeout: 120_000 })
  ).jsonValue();
  await page.close();
}

// 2. Live app: Spectral Tunnel at 1080p on the GPU while a track plays.
async function playbackRun(seconds, label) {
  log(`${label}: ${seconds} s of playback at 1920x1080…`);
  const { ctx, page } = await appPage({ width: 1920, height: 1080 });
  const renderer = await page.evaluate(() => {
    const gl = globalThis.document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await page.getByTestId("track-deep-house-soul").click();
  await page.waitForFunction(() => globalThis.__resonance.store.getState().dsp?.hops > 50);
  if (seconds > 280) await page.evaluate(() => globalThis.__resonance.controller.setLoop(true));
  await page.evaluate(() => {
    globalThis.__bench = { intervals: [], quality: [], dspP95: [], sync: [], lead: [] };
    globalThis.__longtasks.length = 0;
    globalThis.__resonance.store.subscribe((s, prev) => {
      const b = globalThis.__bench;
      if (s.render && s.render !== prev.render) {
        b.intervals.push(...s.render.intervals);
        b.quality.push(s.render.quality);
        if (s.render.mode === 1) {
          b.sync.push(s.render.syncErrorP95);
          b.lead.push(s.render.leadMs);
        }
      }
      if (s.dsp && s.dsp !== prev.dsp && s.dsp.dspP95 > 0) b.dspP95.push(s.dsp.dspP95);
    });
  });
  await page.waitForTimeout(seconds * 1000);
  const r = await page.evaluate(async () => {
    const s = globalThis.__resonance.store.getState();
    let memory = null;
    try {
      memory = (await performance.measureUserAgentSpecificMemory()).bytes;
    } catch {
      // not available
    }
    return {
      bench: globalThis.__bench,
      longtasks: globalThis.__longtasks,
      overruns: s.dsp?.overrunSamples ?? null,
      renderer: s.renderer,
      transport: s.engineInfo?.transport,
      sampleRate: s.engineInfo?.sampleRate,
      jsHeap: performance.memory?.usedJSHeapSize ?? null,
      memory,
    };
  });
  await ctx.close();
  return { ...r, gpu: renderer, seconds };
}
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const run = await playbackRun(RUN_SECS, "render run");
const soak = SOAK_SECS ? await playbackRun(SOAK_SECS, "soak") : null;

// 3. Live mode latency estimate with the fake microphone.
log("live latency…");
let liveLatency;
{
  const { ctx, page } = await appPage({ width: 1280, height: 720 });
  await page.getByTestId("mic-button").click();
  await page.waitForTimeout(4000);
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const v = await page.evaluate(
      () => globalThis.__resonance.store.getState().render?.inputLatencyMs,
    );
    if (v) samples.push(v);
  }
  liveLatency = pct(samples, 0.5);
  await ctx.close();
}
await browser.close();
server.close();

// ---------------------------------------------------------------- report
const intervals = run.bench.intervals;
const frame = {
  count: intervals.length,
  p50: pct(intervals, 0.5),
  p95: pct(intervals, 0.95),
  p99: pct(intervals, 0.99),
  fps: intervals.length ? (intervals.length * 1000) / intervals.reduce((a, b) => a + b, 0) : null,
  maxQuality: Math.max(0, ...run.bench.quality),
};
const results = {
  env: { ...env, chromium: browserVersion, gpu: run.gpu },
  native,
  wasm,
  frame,
  dspWorkerP95: pct(run.bench.dspP95, 0.5),
  syncP95: pct(run.bench.sync, 0.95),
  leadMedian: pct(run.bench.lead, 0.5),
  liveLatency,
  longtasks: run.longtasks.length,
  overruns: run.overruns,
  memoryMB: run.memory ? run.memory / 2 ** 20 : null,
  soak: soak && {
    seconds: soak.seconds,
    overruns: soak.overruns,
    longtasks: soak.longtasks.length,
    memoryMB: soak.memory ? soak.memory / 2 ** 20 : null,
    framesP95: pct(soak.bench.intervals, 0.95),
  },
  size,
  lighthouse,
};
writeFileSync(join(root, "docs/benchmarks.json"), JSON.stringify(results, null, 2) + "\n");

const f1 = (x, d = 1) => (x == null ? "n/a" : Number(x).toFixed(d));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const status = (ok) => (ok == null ? "not measured" : ok ? "met" : "**missed**");
const memSource = soak ?? run;
const memMB = memSource.memory ? memSource.memory / 2 ** 20 : null;

const md = `# Benchmarks

Generated by \`pnpm bench\` (\`scripts/bench.mjs\`) on ${env.date}. Don't edit by hand; rerun the
script. Raw values: [benchmarks.json](benchmarks.json).

## Machine

| | |
|---|---|
| CPU / GPU | ${env.cpu}, ${env.memoryGB} GB RAM |
| WebGL2 renderer | ${run.gpu} |
| OS | ${env.os} |
| Browser | Chromium ${browserVersion} (Playwright, new headless mode), ANGLE on Metal, fake audio output |
| Toolchain | ${env.rustc}, Node ${env.node} |

This is a 2025-class Apple laptop, faster than the PRD's reference machine (an M1/M2 MacBook Air
or Intel Iris Xe laptop), so the CPU-bound numbers are optimistic for that class.

## PRD section 8 targets

| Metric | Target | Measured | Status |
|---|---|---|---|
| Frame rate, 1080p Spectral Tunnel (WebGL2, render worker) | 60 FPS sustained | ${f1(frame.fps)} FPS; frame interval p50 ${f1(frame.p50)} ms, p95 ${f1(frame.p95)} ms over ${run.seconds} s (${frame.count} frames); adaptive quality stayed at level ${frame.maxQuality} | ${status(frame.fps != null && frame.fps >= 59 && frame.p95 <= 18)} |
| Particle Nebula, 500k particles (WebGPU) | 60 FPS | Not built yet (P1, milestone 11) | not measured |
| DSP time per hop (WASM, 2048/512) | p95 < 1 ms | ${f1(wasm.simd.p95Us, 0)} µs p95 (SIMD), ${f1(wasm.scalar.p95Us, 0)} µs p95 (scalar); live DSP worker p95 ${f1(results.dspWorkerP95, 0)} µs | ${status(wasm.simd.p95Us < 1000)} |
| A/V sync error, file mode | within ±15 ms | ${f1(results.syncP95)} ms p95, analysis lead ${f1(results.leadMedian, 0)} ms ([caveat](latency.md#what-this-does-and-doesnt-prove)) | ${status(results.syncP95 != null && results.syncP95 <= 15)} |
| Input latency, live mode | < 50 ms (estimate) | ${f1(liveLatency)} ms (fake capture device; live sources use a 1024/256 STFT) | ${status(liveLatency != null && liveLatency < 50)} |
| Main-thread long tasks during playback | 0 | ${results.longtasks} in ${run.seconds} s${soak ? `; ${soak.longtasks.length} in the ${soak.seconds} s soak` : ""} | ${status((soak ? soak.longtasks.length : 0) + results.longtasks === 0)} |
| Ring-buffer overruns, 10-minute playback | 0 | ${soak ? `${soak.overruns} samples in ${soak.seconds} s` : `${results.overruns} samples in ${run.seconds} s (10-minute soak not run: \`--soak=600\`)`} | ${status(soak ? soak.overruns === 0 : null)} |
| JS + WASM, gzipped | < 350 KB | ${kb(size.total)} (JS ${kb(size.js)}, CSS ${kb(size.css)}, WASM ${kb(size.wasm)}) | ${status(size.total < size.budget)} |
| Time to interactive, broadband | < 2 s | ${lighthouse ? `Lighthouse ${lighthouse.version} desktop: LCP ${f1(lighthouse.lcp, 0)} ms, TBT ${f1(lighthouse.tbt, 0)} ms, FCP ${f1(lighthouse.fcp, 0)} ms (TTI is no longer reported by Lighthouse)` : "Lighthouse run failed"} | ${status(lighthouse ? lighthouse.lcp < 2000 && lighthouse.tbt < 200 : null)} |
| Memory${soak ? `, ${Math.round(soak.seconds / 60)}-minute playback` : `, after ${run.seconds} s`} | < 300 MB (10-minute track) | ${memMB == null ? "measureUserAgentSpecificMemory unavailable" : `${f1(memMB)} MB (\`performance.measureUserAgentSpecificMemory\`: JS heaps, DOM, and ArrayBuffers across the page and its workers; excludes GPU memory and the browser's media buffers)`} | ${status(memMB == null ? null : memMB < 300 && !!soak)} |

${lighthouse ? `Lighthouse scores: performance ${lighthouse.performance}, accessibility ${lighthouse.accessibility}, best practices ${lighthouse.bestPractices} (representative of ${lighthouse.runs} runs).` : ""}

## DSP in the browser (WASM)

Per-hop analysis (STFT 2048, hop 512, 48 kHz: FFT, mel, bands, onsets, tempo) in a worker over a
30 s fixture, 5 passes after a warm-up pass. \`performance.now()\` has ${wasm.simd.timerResolutionUs} µs
resolution in a cross-origin-isolated page, so per-hop percentiles are quantized; the mean comes
from 100-hop batches.

| Build | Mean | p50 | p95 | p99 | Max | Budget used (one hop = 10.7 ms) |
|---|---|---|---|---|---|---|
| SIMD128 | ${f1(wasm.simd.meanUs)} µs | ${f1(wasm.simd.p50Us, 0)} µs | ${f1(wasm.simd.p95Us, 0)} µs | ${f1(wasm.simd.p99Us, 0)} µs | ${f1(wasm.simd.maxUs, 0)} µs | ${f1((wasm.simd.meanUs / 10667) * 100, 2)}% |
| Scalar | ${f1(wasm.scalar.meanUs)} µs | ${f1(wasm.scalar.p50Us, 0)} µs | ${f1(wasm.scalar.p95Us, 0)} µs | ${f1(wasm.scalar.p99Us, 0)} µs | ${f1(wasm.scalar.maxUs, 0)} µs | ${f1((wasm.scalar.meanUs / 10667) * 100, 2)}% |

## DSP natively (criterion)

Median of criterion's estimates, native ${process.arch} build with LTO.

| Transform | Size | Resonance | rustfft | Ratio |
|---|---|---|---|---|
${native.fft.map((r) => `| Complex FFT | ${r.n} | ${f1(r.ours, 2)} µs | ${f1(r.rustfft, 2)} µs | ${r.ours && r.rustfft ? f1(r.ours / r.rustfft, 2) + "x" : "n/a"} |`).join("\n")}
${native.realFft.map((r) => `| Real FFT (half-size complex) | ${r.n} | ${f1(r.ours, 2)} µs | | |`).join("\n")}
| Full analysis hop | 2048 / 512 | ${f1(native.hop, 2)} µs | | |

rustfft uses NEON SIMD and mixed-radix algorithms; Resonance's FFT is a readable iterative
radix-2 transform (see [dsp-notes.md](dsp-notes.md)). It's about 2x slower and uses under 0.1%
of the per-hop time budget.

## Not measured here

- **Real speaker/display latency.** Needs the camera check in [latency.md](latency.md).
- **WebGPU.** Headless Chromium on this machine exposes no WebGPU adapter.
- **Firefox and Safari.** The e2e suite and benchmarks run Chromium only.
`;
writeFileSync(join(root, "docs/benchmarks.md"), md);
log("wrote docs/benchmarks.md");
