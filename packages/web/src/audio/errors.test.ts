import { describe, expect, it } from "vitest";
import { appError, micError, tabError } from "./errors";
import { canCaptureTabAudio } from "./capabilities";

const dom = (name: string) => new DOMException("x", name);

describe("error mapping (ER-2)", () => {
  it("maps getUserMedia failures", () => {
    expect(micError(dom("NotAllowedError")).code).toBe("mic-denied");
    expect(micError(dom("NotFoundError")).code).toBe("mic-not-found");
    expect(micError(dom("NotReadableError")).code).toBe("mic-in-use");
  });

  it("maps getDisplayMedia failures", () => {
    expect(tabError(dom("NotAllowedError")).code).toBe("tab-cancelled");
    expect(tabError(dom("NotSupportedError")).code).toBe("tab-unsupported");
  });

  it("every error has a title and a message", () => {
    for (const code of ["file-too-large", "tab-no-audio", "wasm-failed"] as const) {
      const e = appError(code);
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.message.length).toBeGreaterThan(10);
    }
  });
});

describe("tab audio capability (PRD 5.1.1)", () => {
  const nav = (ua: unknown, gdm = true) =>
    ({
      mediaDevices: gdm ? { getDisplayMedia: () => undefined } : {},
      userAgentData: ua,
    }) as unknown as Navigator;

  it("is offered on Chromium desktop", () => {
    expect(canCaptureTabAudio(nav({ brands: [{ brand: "Chromium" }], mobile: false }))).toBe(true);
  });
  it("is hidden on mobile Chromium", () => {
    expect(canCaptureTabAudio(nav({ brands: [{ brand: "Chromium" }], mobile: true }))).toBe(false);
  });
  it("is hidden on Firefox/Safari (no userAgentData)", () => {
    expect(canCaptureTabAudio(nav(undefined))).toBe(false);
  });
  it("is hidden without getDisplayMedia", () => {
    expect(canCaptureTabAudio(nav({ brands: [{ brand: "Chromium" }] }, false))).toBe(false);
  });
});
