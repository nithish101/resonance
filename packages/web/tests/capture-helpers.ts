import type { Page } from "@playwright/test";

export interface CaptureOptions {
  src: string;
  mode?: string;
  theme?: string;
  seed?: number;
  w?: number;
  h?: number;
  fps?: number;
  reduced?: boolean;
}

export async function openCapture(page: Page, o: CaptureOptions) {
  const q = new URLSearchParams({
    src: o.src,
    mode: o.mode ?? "tunnel",
    theme: o.theme ?? "ember",
    seed: String(o.seed ?? 1),
    w: String(o.w ?? 640),
    h: String(o.h ?? 360),
    fps: String(o.fps ?? 30),
    reduced: o.reduced ? "1" : "0",
  });
  await page.setViewportSize({ width: o.w ?? 640, height: o.h ?? 360 });
  await page.goto(`/capture.html?${q}`);
  return page.evaluate(async () => {
    const c = await (globalThis as unknown as { __capture: Promise<{ duration: number }> })
      .__capture;
    return { duration: c.duration };
  });
}

export function renderAt(page: Page, t: number) {
  return page.evaluate(async (time) => {
    const c = await (globalThis as unknown as { __capture: Promise<{ renderAt(t: number): void }> })
      .__capture;
    c.renderAt(time);
  }, t);
}

export function luminance(page: Page) {
  return page.evaluate(async () => {
    const c = await (globalThis as unknown as { __capture: Promise<{ luminance(): number }> })
      .__capture;
    return c.luminance();
  });
}
