// Post-deploy smoke test (PRD 12): the live site must send the isolation and security headers,
// serve WebAssembly as application/wasm, be crossOriginIsolated in a real browser, and start
// the audio engine.
//
//   node scripts/smoke.mjs https://dxxxx.cloudfront.net          # production checks
//   node scripts/smoke.mjs http://localhost:4173 --local          # against `vite preview`

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { launchChromium, root } from "./lib/serve.mjs";

const url = process.argv[2]?.replace(/\/$/, "");
const local = process.argv.includes("--local");
if (!url) throw new Error("usage: smoke.mjs <url> [--local]");

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const res = await fetch(`${url}/`);
const h = (n) => res.headers.get(n) ?? "";
check(res.ok, `GET / -> ${res.status}`);
check(
  h("cross-origin-opener-policy") === "same-origin",
  `COOP: ${h("cross-origin-opener-policy")}`,
);
check(
  h("cross-origin-embedder-policy") === "require-corp",
  `COEP: ${h("cross-origin-embedder-policy")}`,
);
check(h("content-security-policy").includes("'wasm-unsafe-eval'"), "CSP allows WebAssembly only");
check(h("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
if (!local) {
  check(
    h("strict-transport-security").includes("max-age="),
    `HSTS: ${h("strict-transport-security")}`,
  );
  check(/no-cache/.test(h("cache-control")), `index.html Cache-Control: ${h("cache-control")}`);
}

// WebAssembly files from the build that was deployed.
const wasm = readdirSync(join(root, "packages/web/dist/assets"))
  .filter((f) => f.endsWith(".wasm"))
  .map((f) => `assets/${f}`);
check(wasm.length === 2, `build has ${wasm.length} wasm files (SIMD + scalar)`);
for (const f of wasm) {
  const r = await fetch(`${url}/${f}`);
  check(
    r.ok && r.headers.get("content-type") === "application/wasm",
    `${f}: ${r.status} ${r.headers.get("content-type")}`,
  );
  if (!local)
    check(/immutable/.test(r.headers.get("cache-control") ?? ""), `${f} cached immutably`);
}

// A real browser: isolation, and the engine starts from a click.
const browser = await launchChromium();
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem("resonance.photosensitivity-ack.v1", "1"));
const page = await ctx.newPage();
const cspErrors = [];
page.on("console", (m) => /Content Security Policy/i.test(m.text()) && cspErrors.push(m.text()));
await page.goto(`${url}/`);
check(
  await page.evaluate(() => globalThis.crossOriginIsolated === true),
  "crossOriginIsolated === true",
);
await page.getByTestId("track-deep-house-soul").click();
const started = await page
  .waitForFunction(() => globalThis.__resonance?.store.getState().dsp?.hops > 20, null, {
    timeout: 20_000,
  })
  .then(() => true)
  .catch(() => false);
check(started, "audio engine starts and the WASM analyzer produces frames");
check(cspErrors.length === 0, `no CSP violations (${cspErrors.length})`);
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nsmoke test passed");
