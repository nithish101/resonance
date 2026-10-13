import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const settings = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __resonance: { store: { getState(): { settings: Record<string, unknown> } } };
        }
      ).__resonance.store.getState().settings,
  );

test.describe("shortcuts and shareable settings (UI-4)", () => {
  test("? opens an accessible shortcut sheet and Esc closes it", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Next mode");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("M and T cycle mode and theme, and the URL hash carries them across a reload", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("m");
    await page.keyboard.press("t"); // tempo (default) -> ember
    await page.keyboard.press("t"); // -> tide
    expect(await settings(page)).toMatchObject({ mode: "nebula", theme: "tide" });
    await expect(page).toHaveURL(/#.*mode=nebula/);
    await expect(page).toHaveURL(/theme=tide/);
    await page.reload();
    expect(await settings(page)).toMatchObject({ mode: "nebula", theme: "tide" });
  });

  test("effect toggles are reflected in the shared link", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("s");
    await page.getByTestId("bloom").click();
    await expect(page).toHaveURL(/bloom=0/);
    // Changing only the hash is a same-document navigation; reload so the app reads it at start.
    await page.goto("/#bloom=0&intensity=0.6&mode=laser");
    await page.reload();
    expect(await settings(page)).toMatchObject({ bloom: false, intensity: 0.6, mode: "tunnel" });
  });
});
