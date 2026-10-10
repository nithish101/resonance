// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as dsp from "../wasm/pkg-scalar/dsp.js";
import { F, FRAME_FLOATS, FRAME_SCHEMA_VERSION, FrameBus, createFrame } from "./frames";

const wasmPath = fileURLToPath(new URL("../wasm/pkg-scalar/dsp_bg.wasm", import.meta.url));

describe("feature frame layout", () => {
  it("matches the Rust layout exactly", async () => {
    await dsp.default({ module_or_path: readFileSync(wasmPath) });
    expect(dsp.schemaVersion()).toBe(FRAME_SCHEMA_VERSION);
    expect(dsp.frameFloats()).toBe(FRAME_FLOATS);
    expect(Array.from(dsp.frameOffsets())).toEqual(Object.values(F));
  });

  it("produces frames from the WASM analyzer", async () => {
    const exports = await dsp.default({ module_or_path: readFileSync(wasmPath) });
    const a = new dsp.Analyzer(48000, 2048, 512);
    const input = new Float32Array(exports.memory.buffer, a.inputPtr(), 512);
    let t = 0;
    for (let h = 0; h < 200; h++) {
      for (let i = 0; i < 512; i++, t++)
        input[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * t) / 48000);
      a.process();
    }
    const frame = new Float32Array(exports.memory.buffer, a.framePtr(), FRAME_FLOATS);
    expect(frame[F.centroid]).toBeGreaterThan(940);
    expect(frame[F.centroid]).toBeLessThan(1060);
    expect(frame[F.rms]).toBeCloseTo(0.3536, 2);
    expect(frame[F.gate]).toBe(1);
  });
});

describe("frame bus", () => {
  it("round-trips a frame and rejects overwritten indices", () => {
    const bus = FrameBus.create(4, false);
    const payload = new Float32Array(FRAME_FLOATS);
    for (let i = 0; i < 10; i++) {
      payload.fill(i);
      bus.write(i, i * 512, payload);
    }
    const f = createFrame();
    expect(bus.latest()).toBe(9);
    expect(bus.read(9, f)).toBe(true);
    expect(f.time).toBe(9 * 512);
    expect(f.data[50]).toBe(9);
    expect(bus.read(5, f)).toBe(false); // overwritten by frame 9
    expect(bus.read(10, f)).toBe(false); // not written yet
  });
});
