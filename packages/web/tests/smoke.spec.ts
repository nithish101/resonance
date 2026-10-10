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

test("the production CSP and security headers are served", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  const response = await page.goto("/");
  const h = response?.headers() ?? {};
  expect(h["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["permissions-policy"]).toContain("display-capture=(self)");
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
