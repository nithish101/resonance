// Post-deploy smoke test for the GitHub Pages build: Pages can't send headers, so cross-origin
// isolation comes from the service worker (packages/web/src/coi). Checks that the first visit
// reloads into an isolated page, the shared-memory pipeline runs, and audio reaches the analyzer.
//
//   node scripts/smoke-pages.mjs https://nithish101.github.io/resonance/

import { launchChromium } from "./lib/serve.mjs";

const url = process.argv[2];
if (!url) throw new Error("usage: smoke-pages.mjs <url>");
const browser = await launchChromium();
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem("resonance.photosensitivity-ack.v1", "1"));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

await page.goto(url);
const isolated = await page
  .waitForFunction(() => globalThis.crossOriginIsolated && globalThis.__resonance, null, {
    timeout: 30_000,
  })
  .then(() => true)
  .catch(() => false);
check(isolated, "crossOriginIsolated === true after the service worker's one-time reload");
await page.getByTestId("track-deep-house-soul").click();
const running = await page
  .waitForFunction(
    () => {
      const s = globalThis.__resonance.store.getState();
      return s.dsp?.hops > 100 && s.dsp.rms > 0.001 && s.renderer?.backend;
    },
    null,
    { timeout: 30_000 },
  )
  .then(() => true)
  .catch(() => false);
check(running, "a bundled track plays and the WASM analyzer produces frames");
const info = await page.evaluate(() => {
  const s = globalThis.__resonance?.store.getState();
  return { transport: s?.engineInfo?.transport, renderer: s?.renderer?.backend };
});
check(info.transport === "shared-memory", `transport: ${info.transport}`);
check(errors.length === 0, `no page errors (${errors.join("; ")})`);
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nPages smoke test passed");
