import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { renderState, state } from "./helpers";

async function axe(page: import("@playwright/test").Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.describe("photosensitivity notice (AX-1)", () => {
  test.use({ acceptWarning: false });

  test("shows on first load, gates the picker, and is remembered", async ({ page }) => {
    await page.goto("/");
    const gate = page.getByRole("alertdialog", { name: "Photosensitivity notice" });
    await expect(gate).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Pick something to listen to" })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    // The primary action has focus, so Enter continues.
    await page.keyboard.press("Enter");
    await expect(gate).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Pick something to listen to" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Pick something to listen to" })).toBeVisible();
    await expect(gate).toHaveCount(0);
  });

  test("offers reduced motion up front", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("ps-reduced").click();
    const s = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __resonance: { store: { getState(): { settings: { reducedMotion: boolean } } } };
          }
        ).__resonance.store.getState().settings.reducedMotion,
    );
    expect(s).toBe(true);
  });
});

test.describe("reduced motion (AX-3)", () => {
  test("honours prefers-reduced-motion and can be toggled", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByTestId("settings-button").click();
    const toggle = page.getByTestId("reduced-motion");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
  });
});

test.describe("debug overlay (UI-3)", () => {
  test("D toggles an overlay with real values", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).dsp?.hops ?? 0).toBeGreaterThan(50);
    await page.keyboard.press("d");
    const debug = page.getByTestId("debug");
    await expect(debug).toBeVisible();
    await expect(page.getByTestId("debug-renderer")).toHaveText("webgl2 · worker");
    await expect(page.getByTestId("debug-transport")).toHaveText(/shared-memory/);
    await expect(page.getByTestId("debug-overruns")).toHaveText("0 samples");
    await expect(page.getByTestId("debug-bpm")).toHaveText(/^\d{2,3}\.\d$/, { timeout: 15_000 });
    await expect(debug.getByRole("row", { name: /FPS/ })).toContainText(/\d/);
    await expect(debug.getByRole("row", { name: /DSP per hop/ })).toContainText(/\d+ · \d+ µs/);
    await page.keyboard.press("d");
    await expect(debug).toHaveCount(0);
  });
});

test.describe("controls (UI-1, UI-2, AX-4)", () => {
  test("settings are reachable and operable by keyboard", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("s");
    const panel = page.getByTestId("settings");
    await expect(panel).toBeVisible();
    await page.getByRole("radio", { name: "Tide" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: "Tide" })).toHaveAttribute("aria-checked", "true");
    const intensity = page.getByLabel("Intensity");
    await intensity.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(intensity).toHaveValue("0.95");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("controls auto-hide during playback and return on input", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    const chrome = page.getByTestId("chrome");
    await expect(chrome).toHaveAttribute("data-hidden", "true", { timeout: 8000 });
    await page.mouse.move(200, 200);
    await expect(chrome).toHaveAttribute("data-hidden", "false");
    await expect(chrome).toHaveAttribute("data-hidden", "true", { timeout: 8000 });
    await page.keyboard.press("Tab");
    await expect(chrome).toHaveAttribute("data-hidden", "false");
  });

  test("no axe violations on the picker, while playing, and with panels open", async ({ page }) => {
    await page.goto("/");
    expect(await axe(page)).toEqual([]);
    await page.getByTestId("track-deep-house-soul").click();
    await expect(page.getByTestId("now-playing")).toBeVisible();
    await page.keyboard.press("s");
    await page.keyboard.press("d");
    await expect(page.getByTestId("settings")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});

test.describe("capability banner (UI-5)", () => {
  test("names the active backend and explains a fallback", async ({ page }) => {
    await page.goto("/?renderer=main&coi=0");
    await expect(page.getByTestId("capability-pill")).toHaveText(/WebGL2 · main/);
    const banner = page.getByTestId("capability-banner");
    // The banner waits for playback so it never covers the source picker.
    await expect(banner).toHaveCount(0);
    await page.getByTestId("track-deep-house-soul").click();
    await expect(banner).toContainText("main thread");
    await expect(page.getByTestId("capability-pill")).toHaveText(/postMessage/);
    await expect(banner).toContainText("cross-origin isolated");
    await banner.getByRole("button", { name: "OK" }).click();
    await expect(banner).toHaveCount(0);
    expect((await renderState(page)).renderer?.location).toBe("main");
  });
});
