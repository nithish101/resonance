import { expect, test } from "@playwright/test";
import { state } from "./helpers";

// End-to-end tab capture (IN-4) through the real getDisplayMedia path: the share dialog is
// auto-answered with the tab titled "ToneSource".
//
// Known gap (docs/plan.md problem log): headless Chromium returns a live audio track for the
// captured tab, but it carries silence, because a headless tab has no real audio output to tap.
// So this test checks the wiring (dialog -> audio track -> Live mode -> DSP running on the
// captured stream). That analysed audio arrives intact is covered by the mocked-stream test in
// audio.spec.ts, and by a manual check with YouTube Music in headed Chrome.
test("captures another tab through the real share flow", async ({ context }) => {
  const source = await context.newPage();
  await source.goto("/stress.html");
  await source.evaluate(async () => {
    document.title = "ToneSource";
    const a = new Audio("/audio/fixtures/sine-1000.wav");
    a.loop = true;
    await a.play();
  });

  const app = await context.newPage();
  await app.goto("/");
  await app.getByTestId("tab-button").click();
  await expect(app.getByText("Live")).toBeVisible();
  expect((await state(app)).source?.kind).toBe("tab");
  const hops = async () => (await state(app)).dsp?.hops ?? 0;
  await expect.poll(hops, { timeout: 10_000 }).toBeGreaterThan(20);
  const before = await hops();
  await expect.poll(hops).toBeGreaterThan(before + 20);
});
