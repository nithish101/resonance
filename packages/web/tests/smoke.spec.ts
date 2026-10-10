import { expect, test } from "@playwright/test";

test("the page is served cross-origin isolated", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
});

test("?coi=0 serves a non-isolated page for the postMessage fallback", async ({ page }) => {
  await page.goto("/?coi=0");
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
});
