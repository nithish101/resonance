// `pnpm capture`: reproducible screenshots and the hero GIF (PRD 13).
//
// Mode screenshots and the GIF come from deterministic capture mode (RD-11): the bundled track is
// decoded and analysed offline, and frames are rendered at fixed audio times under SwiftShader,
// so reruns produce the same pixels. UI screenshots (debug overlay, settings, fallback banner)
// come from the live app playing the same track; their numbers are real readings taken on the
// machine running the script.

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import gifenc from "gifenc";
import { buildAndServe, launchChromium, root } from "./lib/serve.mjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const out = join(root, "docs/screenshots");
mkdirSync(out, { recursive: true });
const TRACK = "/audio/tracks/deep-house-soul.mp3";

const server = await buildAndServe();
const browser = await launchChromium([
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
]);

async function capturePage(opts) {
  const page = await browser.newPage({ viewport: { width: opts.w, height: opts.h } });
  const q = new URLSearchParams({
    src: TRACK,
    w: opts.w,
    h: opts.h,
    fps: opts.fps ?? 30,
    mode: opts.mode ?? "tunnel",
    theme: opts.theme ?? "ember",
    seed: 1,
    // Grain changes every pixel every frame, which defeats GIF compression; stills keep it.
    grain: opts.grain === false ? 0 : 1,
  });
  await page.goto(`${server.url}/capture.html?${q}`);
  await page.evaluate(() => globalThis.__capture);
  return {
    page,
    render: (t) => page.evaluate(async (time) => (await globalThis.__capture).renderAt(time), t),
    theme: (id) => page.evaluate(async (id) => (await globalThis.__capture).setTheme(id), id),
    shot: () => page.locator("#c").screenshot(),
  };
}

// 1. Mode and theme stills.
const stills = [
  { name: "tunnel-ember", theme: "ember", t: 74.0 },
  { name: "tunnel-tide", theme: "tide", t: 96.5 },
  { name: "tunnel-aurora", theme: "aurora", t: 131.2 },
  { name: "nebula-ember", theme: "ember", t: 75.0, mode: "nebula" },
  { name: "nebula-tide", theme: "tide", t: 112.0, mode: "nebula" },
];
for (const s of stills) {
  const c = await capturePage({ w: 1600, h: 900, theme: s.theme, mode: s.mode });
  await c.render(s.t);
  writeFileSync(join(out, `${s.name}.png`), await c.shot());
  await c.page.close();
  console.log(`still ${s.name}`);
}

// 2. Hero GIF: 10 s at 15 fps, cycling themes every ~3.3 s.
{
  const w = 560;
  const h = 315;
  const fps = 15;
  const c = await capturePage({ w, h, fps, grain: false });
  const gif = GIFEncoder();
  const start = 70;
  // Every available mode, in a few themes.
  const segments = [
    { mode: "tunnel", theme: "ember" },
    { mode: "nebula", theme: "ember" },
    { mode: "tunnel", theme: "tide" },
    { mode: "nebula", theme: "aurora" },
  ];
  const themes = segments.map((x) => `${x.mode}:${x.theme}`);
  const frames = 10 * fps;
  // One palette per theme segment, built from a few of its frames: stable colours (no
  // per-frame palette flicker) and much better LZW compression than per-frame palettes.
  const palettes = new Map();
  for (const [k, theme] of themes.entries()) {
    await c.theme(theme);
    const samples = [];
    for (const f of [0.15, 0.5, 0.85]) {
      await c.render(start + ((k + f) / themes.length) * 10);
      samples.push(PNG.sync.read(await c.shot()).data);
    }
    const joined = new Uint8Array(samples.reduce((n, d) => n + d.length, 0));
    let o = 0;
    for (const d of samples) {
      joined.set(d, o);
      o += d.length;
    }
    palettes.set(theme, quantize(joined, 256));
  }
  await c.page.close();
  const c2 = await capturePage({ w, h, fps, grain: false });
  for (let i = 0; i < frames; i++) {
    const theme = themes[Math.min(themes.length - 1, Math.floor((i / frames) * themes.length))];
    if (i === 0 || theme !== themes[Math.floor(((i - 1) / frames) * themes.length)])
      await c2.theme(theme);
    await c2.render(start + i / fps);
    const png = PNG.sync.read(await c2.shot());
    const palette = palettes.get(theme);
    const index = applyPalette(png.data, palette);
    gif.writeFrame(index, w, h, { palette, delay: Math.round(1000 / fps) });
  }
  gif.finish();
  writeFileSync(join(out, "hero.gif"), gif.bytes());
  console.log(`hero.gif ${(statSync(join(out, "hero.gif")).size / 1e6).toFixed(1)} MB`);
  await c2.page.close();
}

// 3. UI screenshots from the live app.
async function app(query = "") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("resonance.photosensitivity-ack.v1", "1"));
  const page = await ctx.newPage();
  await page.goto(`${server.url}/${query}`);
  return { ctx, page };
}
{
  const { ctx, page } = await app();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "picker.png") });
  await page.getByTestId("track-deep-house-soul").click();
  await page.evaluate(() => globalThis.__resonance.controller.seek(70));
  await page.waitForTimeout(8000);
  await page.keyboard.press("d");
  await page.waitForTimeout(1500);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(700); // chrome fade-in
  await page.screenshot({ path: join(out, "debug-overlay.png") });
  await page.keyboard.press("d");
  await page.keyboard.press("s");
  await page.mouse.move(710, 450);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, "settings.png") });
  await ctx.close();
}
{
  const { ctx, page } = await app("?renderer=main&coi=0");
  await page.getByTestId("track-deep-house-soul").click();
  await page.evaluate(() => globalThis.__resonance.controller.seek(70));
  await page.waitForTimeout(6000);
  await page.mouse.move(700, 450);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, "fallback-banner.png") });
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(server.url);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "photosensitivity.png") });
  await ctx.close();
}
console.log("ui screenshots done");

await browser.close();
server.close();
