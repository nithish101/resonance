import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RingConsumer, RingProducer, createRing } from "./ring";

/** Fills a chunk with consecutive integers starting at `start` (exact in float32 below 2^24). */
function chunk(start: number, n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = (start + i) % (1 << 24);
  return a;
}

function seedIndices(sab: SharedArrayBuffer, value: number) {
  const h = new Int32Array(sab, 0, 4);
  h[0] = value | 0;
  h[1] = value | 0;
}

describe("SPSC ring buffer", () => {
  it("delivers samples in order with their stream index and start frame", () => {
    const layout = createRing(4096, 256);
    const p = new RingProducer(layout);
    const c = new RingConsumer(layout);
    p.push(chunk(0, 128), 1000);
    p.push(chunk(128, 128), 1128);
    const dest = new Float32Array(1000);
    const r = c.readInto(dest);
    expect(r).toEqual({ count: 256, index: 0, dropped: 0 });
    expect(Array.from(dest.subarray(0, 256))).toEqual(Array.from(chunk(0, 256)));
    expect(c.firstFrame).toBe(1000);
    expect(c.overruns).toBe(0);
  });

  it("drops the oldest samples on overflow and counts them", () => {
    const layout = createRing(1024, 128);
    const p = new RingProducer(layout);
    const c = new RingConsumer(layout);
    for (let i = 0; i < 20; i++) p.push(chunk(i * 128, 128), 0); // 2560 samples into 1024
    const dest = new Float32Array(4096);
    const r = c.readInto(dest);
    // Keeps the newest capacity - margin samples.
    expect(r.count).toBe(1024 - 128);
    expect(r.dropped).toBe(2560 - (1024 - 128));
    expect(r.index).toBe(r.dropped);
    expect(dest[0]).toBe(r.index);
    expect(dest[r.count - 1]).toBe(2559);
    expect(c.overruns).toBe(r.dropped);
  });

  it("handles 32-bit index wraparound", () => {
    const layout = createRing(1024, 128);
    seedIndices(layout.sab, 0xffffff00);
    const p = new RingProducer(layout);
    const c = new RingConsumer(layout);
    const dest = new Float32Array(512);
    let next = 0;
    for (let i = 0; i < 10; i++) {
      p.push(chunk(i * 100, 100), 0);
      const r = c.readInto(dest);
      expect(r.dropped).toBe(0);
      for (let k = 0; k < r.count; k++) expect(dest[k]).toBe(next++);
    }
    expect(next).toBe(1000);
  });

  it("rejects bad configurations", () => {
    expect(() => createRing(1000)).toThrow(/power of two/);
    expect(() => createRing(1024, 512)).toThrow(/4x/);
  });

  it("property: never reorders, duplicates, or invents samples, and accounts for every one", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ op: fc.constant("push" as const), n: fc.integer({ min: 1, max: 128 }) }),
            fc.record({ op: fc.constant("read" as const), n: fc.integer({ min: 1, max: 700 }) }),
          ),
          { maxLength: 200 },
        ),
        fc.integer({ min: 0, max: 0xffffffff }),
        (ops, seed) => {
          const layout = createRing(512, 128);
          seedIndices(layout.sab, seed);
          const p = new RingProducer(layout);
          const c = new RingConsumer(layout);
          let produced = 0;
          let consumed = 0;
          let dropped = 0;
          let lastIndex = -1;
          for (const o of ops) {
            if (o.op === "push") {
              p.push(chunk(produced, o.n), 0);
              produced += o.n;
            } else {
              const dest = new Float32Array(o.n);
              const r = c.readInto(dest);
              dropped += r.dropped;
              if (r.count > 0) {
                expect(r.index).toBeGreaterThan(lastIndex);
                for (let k = 0; k < r.count; k++) expect(dest[k]).toBe((r.index + k) % (1 << 24));
                lastIndex = r.index + r.count - 1;
              }
              consumed += r.count;
              // Never more pending than fits.
              expect(c.available()).toBeLessThanOrEqual(512);
            }
          }
          const rest = new Float32Array(1024);
          const r = c.readInto(rest);
          consumed += r.count;
          dropped += r.dropped;
          expect(consumed + dropped).toBe(produced);
          expect(c.overruns).toBe(dropped);
        },
      ),
      { numRuns: 300 },
    );
  });
});
