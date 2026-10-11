import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "./store";
import { decodeSettings, encodeSettings } from "./urlSettings";

describe("URL-hash settings (UI-4)", () => {
  it("writes nothing for defaults", () => {
    expect(encodeSettings(DEFAULT_APP_SETTINGS)).toBe("");
  });

  it("round-trips changed values", () => {
    const s = {
      ...DEFAULT_APP_SETTINGS,
      mode: "nebula" as const,
      theme: "tide",
      intensity: 0.75,
      particles: 500_000,
      bloom: false,
      reducedMotion: true,
    };
    const hash = encodeSettings(s);
    expect(hash).toContain("mode=nebula");
    expect({ ...DEFAULT_APP_SETTINGS, ...decodeSettings(`#${hash}`) }).toEqual(s);
  });

  it("ignores unknown and out-of-range values", () => {
    expect(decodeSettings("#mode=laser&theme=nope&intensity=9&particles=abc&bloom=maybe")).toEqual(
      {},
    );
  });
});
