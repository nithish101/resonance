import { expect, test } from "./fixtures";
import { state, wav } from "./helpers";

test.describe("audio pipeline", () => {
  test("the start prompt gates audio until a user gesture (ER-1)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Pick something to listen to" })).toBeVisible();
    expect((await state(page)).engine).toBe("off");
  });

  test("a bundled track plays over the shared-memory transport", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect(page.getByTestId("now-playing")).toHaveText(/Deep House Soul/);
    await expect
      .poll(async () => (await state(page)).dsp?.rms ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.001);
    const s = await state(page);
    expect(s.engineInfo?.transport).toBe("shared-memory");
    expect(s.dsp!.hops).toBeGreaterThan(10);
    expect(s.dsp!.overrunSamples).toBe(0);
    expect(s.playback.playing).toBe(true);
  });

  test("falls back to postMessage when not cross-origin isolated (ER-3)", async ({ page }) => {
    await page.goto("/?coi=0");
    await page.getByTestId("track-morning-assembly").click();
    await expect
      .poll(async () => (await state(page)).dsp?.rms ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.001);
    expect((await state(page)).engineInfo?.transport).toBe("postMessage");
  });

  test("a user file plays through the media element (IN-1)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({
      name: "tone.wav",
      mimeType: "audio/wav",
      buffer: wav(48000, 4),
    });
    await expect(page.getByTestId("now-playing")).toHaveText("tone.wav");
    await expect
      .poll(async () => (await state(page)).dsp?.rms ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.01);
  });

  test("transport: pause, seek, loop", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).playback.playing).toBe(true);
    await page.getByTestId("play-toggle").click();
    await expect.poll(async () => (await state(page)).playback.playing).toBe(false);
    // Playwright's fill() sets .value directly, which React's change tracking ignores for range
    // inputs; use the native setter plus an input event, as a real drag would produce.
    await page.getByRole("slider", { name: "Seek" }).evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "120");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect.poll(async () => (await state(page)).playback.time).toBeGreaterThan(119);
    await page.getByRole("button", { name: "Loop" }).click();
    await expect(page.getByRole("button", { name: "Loop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("microphone input via Chrome's fake device runs the pipeline (IN-3)", async ({ page }) => {
    // Chrome's fake capture device only beeps now and then, so this test checks the real
    // getUserMedia path and that analysis runs; the next test checks audio content.
    await page.goto("/");
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("now-playing")).toBeVisible();
    expect((await state(page)).source?.kind).toBe("mic");
    const hops = async () => (await state(page)).dsp?.hops ?? 0;
    await expect.poll(hops).toBeGreaterThan(20);
    const before = await hops();
    await expect.poll(hops).toBeGreaterThan(before + 20);
  });

  test("microphone audio is analysed, with voice processing disabled (IN-3)", async ({ page }) => {
    await page.addInitScript(() => {
      const w = globalThis as unknown as { __constraints: unknown };
      navigator.mediaDevices.getUserMedia = async (c) => {
        w.__constraints = c;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return dest.stream;
      };
    });
    await page.goto("/");
    await page.getByTestId("mic-button").click();
    await expect
      .poll(async () => (await state(page)).dsp?.rms ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.01);
    const c = (await page.evaluate(
      () => (globalThis as unknown as { __constraints: unknown }).__constraints,
    )) as { audio: Record<string, unknown> };
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.noiseSuppression).toBe(false);
    expect(c.audio.autoGainControl).toBe(false);
  });
});

test.describe("error states (ER-2, IN-6, ER-5)", () => {
  test("file too large", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      const big = new File([new Uint8Array(101 * 1024 * 1024)], "huge.mp3", {
        type: "audio/mpeg",
      });
      const r = (
        globalThis as unknown as {
          __resonance: { controller: { playFile(f: File): Promise<void> } };
        }
      ).__resonance;
      return r.controller.playFile(big);
    });
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "file-too-large");
  });

  test("unsupported format", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not audio"),
    });
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "unsupported-format");
    await expect(page.getByTestId("error")).toContainText("Unsupported audio format");
  });

  test("undecodable file", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({
      name: "broken.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.alloc(64 * 1024, 7),
    });
    await expect(page.getByTestId("error")).toHaveAttribute(
      "data-code",
      /^(decode-failed|unsupported-format)$/,
    );
  });

  test("track longer than 15 minutes", async ({ page }) => {
    // Chrome derives WAV duration from the real data length, so a short file can't fake a long
    // one; report a 16-minute duration from the element instead.
    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, "duration", { get: () => 16 * 60 });
    });
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles({
      name: "long.wav",
      mimeType: "audio/wav",
      buffer: wav(8000, 1),
    });
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "file-too-long");
  });

  test("microphone permission denied", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    await page.goto("/");
    await page.getByTestId("mic-button").click();
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "mic-denied");
  });

  test("WASM load failure shows an error state (ER-5)", async ({ page }) => {
    await page.goto("/?wasm=fail");
    await page.getByTestId("track-deep-house-soul").click();
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "wasm-failed");
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  });
});

test.describe("tab capture (IN-4, IN-8)", () => {
  test("a shared tab without audio gets a specific message", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const c = document.createElement("canvas");
        return c.captureStream(); // video only: the user didn't tick "Share tab audio"
      };
    });
    await page.goto("/");
    await page.getByTestId("tab-button").click();
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "tab-no-audio");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("cancelling the share dialog is handled", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException("cancelled", "NotAllowedError"));
    });
    await page.goto("/");
    await page.getByTestId("tab-button").click();
    await expect(page.getByTestId("error")).toHaveAttribute("data-code", "tab-cancelled");
  });

  test("captured tab audio is analysed, silence shows a hint, and Stop sharing returns to idle", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = globalThis as unknown as { __tone: OscillatorNode; __track: MediaStreamTrack };
      navigator.mediaDevices.getDisplayMedia = async () => {
        // Stand-in for a captured tab: an oscillator in its own AudioContext.
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        w.__tone = osc;
        w.__track = dest.stream.getAudioTracks()[0]!;
        const c = document.createElement("canvas");
        return new MediaStream([...c.captureStream().getVideoTracks(), w.__track]);
      };
    });
    await page.goto("/");
    await page.getByTestId("tab-button").click();
    await expect(page.getByText("Live")).toBeVisible();
    await expect
      .poll(async () => (await state(page)).dsp?.rms ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0.01);

    // The source goes quiet: after ~3 s the IN-8 hint appears.
    await page.evaluate(() => (globalThis as unknown as { __tone: OscillatorNode }).__tone.stop());
    await expect(page.getByTestId("silent-hint")).toBeVisible({ timeout: 10_000 });

    // The browser's "Stop sharing" ends the track.
    await page.evaluate(() => {
      const t = (globalThis as unknown as { __track: MediaStreamTrack }).__track;
      t.stop();
      t.dispatchEvent(new Event("ended"));
    });
    await expect(page.getByRole("dialog", { name: "Pick something to listen to" })).toBeVisible();
    expect((await state(page)).source).toBeNull();
  });
});

test.describe("DSP in the browser (M3)", () => {
  for (const transport of ["shared-memory", "postMessage"] as const) {
    test(`a 1 kHz tone yields a 1 kHz centroid over ${transport}`, async ({ page }) => {
      await page.goto(transport === "postMessage" ? "/?coi=0" : "/");
      await page.getByTestId("track-deep-house-soul").click();
      await expect.poll(async () => (await state(page)).engine).toBe("ready");
      await page.evaluate(() => {
        const r = (
          globalThis as unknown as {
            __resonance: { controller: { getEngine(): { playUrl(u: string): Promise<void> } } };
          }
        ).__resonance;
        return r.controller.getEngine().playUrl("/audio/fixtures/sine-1000.wav");
      });
      await expect
        .poll(async () => (await state(page)).dsp?.centroid ?? 0, { timeout: 15_000 })
        .toBeGreaterThan(900);
      const s = await state(page);
      expect(s.dsp!.centroid).toBeLessThan(1100);
      // 1 kHz is in the "mid" band (index 3), which should dominate.
      const bands = s.dsp!.bands;
      expect(bands.indexOf(Math.max(...bands))).toBe(3);
      expect(s.dsp!.gate).toBe(1);
    });
  }

  test("a click track produces onsets at the expected rate", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("track-deep-house-soul").click();
    await expect.poll(async () => (await state(page)).engine).toBe("ready");
    await page.evaluate(() => {
      const r = (
        globalThis as unknown as {
          __resonance: { controller: { getEngine(): { playUrl(u: string): Promise<void> } } };
        }
      ).__resonance;
      return r.controller.getEngine().playUrl("/audio/fixtures/click-120.wav");
    });
    const start = (await state(page)).dsp?.onsets ?? 0;
    await page.waitForTimeout(5000);
    const n = ((await state(page)).dsp?.onsets ?? 0) - start;
    // 120 BPM = 2 clicks/s; allow for the 0.5 s lead-in and timing slop.
    expect(n).toBeGreaterThanOrEqual(7);
    expect(n).toBeLessThanOrEqual(11);
    // Tempo (DSP-6) needs about 3 s of onset envelope before its first estimate.
    await expect
      .poll(async () => (await state(page)).dsp?.bpm ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(118);
    expect((await state(page)).dsp!.bpm).toBeLessThan(122);
  });
});
