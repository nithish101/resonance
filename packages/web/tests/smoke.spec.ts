import { expect, test } from "@playwright/test";

test("page is cross-origin isolated and the WASM DSP loads in a worker", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  await expect(page.getByTestId("coi")).toHaveText("true");
  await expect(page.getByTestId("dsp")).toHaveText(/schema v1 \(SIMD\)/);
});

test("?coi=0 serves a non-isolated page for the postMessage fallback", async ({ page }) => {
  await page.goto("/?coi=0");
  await expect(page.getByTestId("coi")).toHaveText("false");
});
