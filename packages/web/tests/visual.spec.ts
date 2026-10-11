import { expect, test } from "@playwright/test";
import { openCapture, renderAt } from "./capture-helpers";

// Visual regression (PRD 9.1): capture mode (RD-11) on WebGL2 under SwiftShader, compared with
// committed goldens. Update with `pnpm --filter @resonance/web exec playwright test visual
// --update-snapshots` after an intentional visual change, and review the diff.

const MOMENTS = [2.0, 7.5, 13.25];

test.describe("visual regression", () => {
  for (const t of MOMENTS) {
    test(`spectral tunnel at ${t}s of groove-120`, async ({ page }) => {
      await openCapture(page, { src: "/audio/fixtures/groove-120.wav" });
      await renderAt(page, t);
      await expect(page.locator("#c")).toHaveScreenshot(`tunnel-groove-${t}.png`, {
        maxDiffPixelRatio: 0.01,
        threshold: 0.15,
      });
    });
  }

  test("capture is deterministic: same input, same pixels", async ({ browser }) => {
    const shots: Buffer[] = [];
    for (let i = 0; i < 2; i++) {
      const page = await browser.newPage();
      await openCapture(page, { src: "/audio/fixtures/groove-120.wav", seed: 7 });
      await renderAt(page, 5.0);
      shots.push(await page.locator("#c").screenshot());
      await page.close();
    }
    expect(shots[0]!.equals(shots[1]!)).toBe(true);
  });

  test("particle nebula (WebGL2, stateless) at 7.5s of groove-120", async ({ page }) => {
    await openCapture(page, { src: "/audio/fixtures/groove-120.wav", mode: "nebula" });
    await renderAt(page, 7.5);
    await expect(page.locator("#c")).toHaveScreenshot("nebula-groove-7-5.png", {
      maxDiffPixelRatio: 0.01,
      threshold: 0.15,
    });
  });

  test("chroma bloom at 12s of groove-120 (C major)", async ({ page }) => {
    await openCapture(page, { src: "/audio/fixtures/groove-120.wav", mode: "bloom" });
    await renderAt(page, 12.0);
    await expect(page.locator("#c")).toHaveScreenshot("bloom-groove-12.png", {
      maxDiffPixelRatio: 0.01,
      threshold: 0.15,
    });
  });

  test("crossfade between modes is deterministic (RD-7)", async ({ page }) => {
    await openCapture(page, { src: "/audio/fixtures/groove-120.wav" });
    await renderAt(page, 6.0);
    await page.evaluate(async () => {
      const c = await (
        globalThis as unknown as { __capture: Promise<{ setTheme(id: string): void }> }
      ).__capture;
      c.setTheme("nebula:ember");
    });
    await renderAt(page, 6.4); // halfway through the 0.8 s fade
    await expect(page.locator("#c")).toHaveScreenshot("crossfade-tunnel-nebula.png", {
      maxDiffPixelRatio: 0.01,
      threshold: 0.15,
    });
  });

  test("themes and reduced motion render distinctly", async ({ page }) => {
    await openCapture(page, {
      src: "/audio/fixtures/groove-120.wav",
      theme: "tide",
      reduced: true,
    });
    await renderAt(page, 7.5);
    await expect(page.locator("#c")).toHaveScreenshot("tunnel-groove-tide-reduced.png", {
      maxDiffPixelRatio: 0.01,
      threshold: 0.15,
    });
  });
});
