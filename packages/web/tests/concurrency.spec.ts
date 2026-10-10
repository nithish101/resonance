import { expect, test } from "@playwright/test";

interface Stress {
  ringPaced: Record<string, number>;
  ringFlood: Record<string, number>;
  ringSlow: Record<string, number>;
  bus: Record<string, number>;
}

test("ring buffer and seqlock frame bus under multi-worker stress (PRD 9.1)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stress.html");
  const r = await page.waitForFunction(
    () => (globalThis as unknown as { __stress?: unknown }).__stress,
    undefined,
    { timeout: 100_000 },
  );
  const s = (await r.jsonValue()) as Stress;
  console.log(JSON.stringify(s));

  for (const ring of [s.ringPaced, s.ringFlood, s.ringSlow]) {
    expect(ring.corrupt).toBe(0);
    expect(ring.outOfOrder).toBe(0);
    expect(ring.consumed! + ring.dropped!).toBe(ring.produced);
    expect(ring.overruns).toBe(ring.dropped);
  }
  // At realistic rates nothing is lost; under flood the drop-oldest path is exercised.
  expect(s.ringPaced.dropped).toBe(0);
  expect(s.ringFlood.dropped).toBeGreaterThan(0);
  expect(s.ringSlow.dropped).toBeGreaterThan(0);

  expect(s.bus.torn).toBe(0);
  expect(s.bus.reads).toBeGreaterThan(1000);
});
