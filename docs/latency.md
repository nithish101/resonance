# Latency and A/V sync

Resonance wants the visuals to match what the listener _hears_, not what was just captured
(PRD 6.3). This document explains how that's done, what the debug overlay's timing numbers mean,
what software can and can't measure, and how to check it with a camera.

## Two modes, two goals

| Source                 | What's known                      | Goal                              | Overlay shows                 |
| ---------------------- | --------------------------------- | --------------------------------- | ----------------------------- |
| File or bundled track  | The audio ahead of what's audible | Visuals land on the sound         | A/V sync error, analysis lead |
| Mic, tab, system audio | Nothing ahead of "now"            | Minimum capture-to-photon latency | Input latency (estimate)      |

## The clocks involved

- **Audio-context time.** Every sample through the Web Audio graph has a position on the
  `AudioContext` timeline. The AudioWorklet tap records the context frame of the first sample it
  writes; every later sample's position follows from its index in the ring buffer
  ([ADR 0002](decisions/0002-pcm-ring-buffer.md)).
- **Feature-frame timestamps.** Each frame is stamped with the context position of the _centre_
  of its analysis window (2048 samples, so the centre trails the newest sample by 1024).
- **Output time.** `AudioContext.getOutputTimestamp()` returns `{contextTime, performanceTime}`:
  the context position of the sample the output device is playing, and when (on the
  `performance.now()` clock). Where the browser doesn't provide it, Resonance falls back to
  `currentTime - baseLatency - outputLatency`.
- **Cross-thread wall clock.** `performance.timeOrigin + performance.now()` is comparable across
  the main thread and workers, so the render worker can extrapolate the latest clock sample to
  its own "now".

The main thread samples the output clock every animation frame and publishes it to the renderer:
a seqlocked `Float64Array` on a `SharedArrayBuffer` when the page is cross-origin isolated, or one
small `postMessage` per frame otherwise (`packages/web/src/lib/clock.ts`).

## File mode: sync to the output

Files play through a **lookahead delay** ([ADR 0003](decisions/0003-playback-path-and-lookahead.md)):

```
<audio> -> MediaElementSource -+-> AudioWorklet tap -> DSP worker      (analysis, now)
                               +-> DelayNode (100 ms) -> gain -> speakers (heard 100 ms later)
```

So every sample is analysed 100 ms before it reaches the output stage. Each rendered frame the
renderer computes

```
audible = clock.contextTime + (now - clock.performanceTime)        // what the device plays now
target  = (audible - lookahead) * sampleRate                       // tap position of that sound
```

and shows the feature frame for `target`, interpolated between the two analysed frames that
bracket it.

**A/V sync error** (overlay, p50 and p95 of the absolute value) is `target` minus the timestamp of
the features actually shown, as the PRD defines it. **Analysis lead** is how far the newest
analysed frame is ahead of `target`: the safety margin. As long as the lead is positive, the
renderer can show exactly the target moment, and the sync error is 0 up to interpolation. If
the analysis ever falls behind (a stalled worker, a long GC pause), the renderer shows the newest
frame and the error becomes the size of the shortfall.

### What this does and doesn't prove

The software sync error measures whether the renderer showed the frame it _meant_ to show. It
can't measure whether the browser's output timestamp matches the sound coming out of the
speaker. That depends on:

- **Driver-reported latency.** `outputLatency` and the output timestamp are the browser's
  estimate of the device pipeline. Most built-in outputs are accurate to a few milliseconds.
- **Bluetooth.** Headphones add 100-300 ms of codec and radio delay that browsers often don't
  report. Some macOS and Android stacks report it, many don't.
- **Display latency.** A frame drawn now appears on the next vsync, plus the panel's own
  processing time (roughly 5-20 ms on typical laptop panels). Resonance doesn't compensate for this.

Only an external measurement can close that loop; see the camera check below.

## Live mode: minimum latency

With no future to look at, the renderer always draws the newest frame. The overlay estimates
capture-to-photon latency as

```
input latency = track.getSettings().latency      // input device, where reported
              + (processing position - frame centre)
              + one display refresh interval
```

where the processing position is the output timestamp plus `outputLatency`. The middle term is
dominated by the half-window: a frame's centre trails its newest sample by half the window, plus
up to one hop of waiting for the next frame. With the file-mode STFT (2048/512) that was 53.6 ms
end to end, missing the 50 ms target. Live sources therefore switch the analyzer to a 1024-sample
window and 256-sample hop (`AudioEngine.configureAnalysis`), which brings the estimate to about
35 ms. The cost is coarser bins (47 Hz at 48 kHz) in the lowest bass; files keep 2048/512 because
the lookahead hides their latency.

## Measured numbers

All measured with the e2e harness on the build machine (Apple M5, headless Chromium 156, output
muted, fake media devices). Headless Chromium uses a virtual audio output with no hardware, so
these numbers validate the pipeline, not a speaker.

| Metric                                    | Value                                                                | Notes                                                        |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| A/V sync error, file mode                 | 0.0 ms p50, 0.0 ms p95                                               | The renderer always found the target frame; see caveat above |
| Analysis lead, file mode                  | ~97 ms                                                               | With the 100 ms lookahead; never went negative               |
| Input latency estimate, live mode         | ~48 ms with a 2048/512 STFT; ~35 ms with the live-mode 1024/256 STFT | Fake mic device, 48 kHz                                      |
| Output timestamp lag behind `currentTime` | ~30 ms                                                               | `outputLatency` reported 24 ms, `baseLatency` 5.3 ms         |

Headed measurements on real hardware are listed in [benchmarks.md](benchmarks.md) once they've
been taken.

## The camera check

The calibration mode turns the screen into a click-synchronised strobe:

1. Open `/?calibrate=1`, accept the notice, and choose **Calibration clicks (120 BPM)**. The
   screen goes black and flashes white on each detected click (twice a second, inside the
   flash limit).
2. Put the speaker next to the screen and film both with a phone in slow motion (240 fps gives
   about 4 ms resolution).
3. In a video editor, step frame by frame: note the frame where the click's waveform starts
   (most editors show audio) and the first frame where the screen turns white. The difference is
   the true end-to-end offset: analysis timing, output-latency estimation, and display latency
   together.

A positive offset (flash after click) can be compensated by increasing the lookahead target;
a negative one means the browser over-reports output latency.

The flash fires on the _detected_ onset, so the measurement includes the onset detector's timing
bias: about 10 ms early on synthetic clicks (`crates/dsp/tests/analyzer.rs`).

## Tuning knobs

| Parameter   | Where                       | Default                                     | Effect                                                                                           |
| ----------- | --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Lookahead   | `AudioEngine` (`lookahead`) | 100 ms                                      | Analysis safety margin in file mode; adds the same delay between pressing play and hearing sound |
| Frame / hop | `EngineOptions`             | 2048 / 512 for files, halved for live input | Smaller frames cut latency and frequency resolution together                                     |
