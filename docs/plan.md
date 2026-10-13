# Resonance build plan

Source of truth: [`PRD.md`](../PRD.md). Requirement IDs and priorities (P0/P1/P2) come from there.

## Working rules

- One milestone at a time. A milestone is done only when format, lint, type-check, and all
  tests are green, the box below is ticked, and the work is committed with a conventional-commit
  message.
- All P0 work and the MVP cut line (milestone 10) come before any P1 work. P2 waits until all P1 is done.
- Every number in the README comes from `pnpm bench` or `pnpm eval`, with the hardware recorded.
  Nothing invented.
- Significant design choices get an ADR in `docs/decisions/`. Real problems and how they were
  solved go in the [problem log](#problem-log) below, which feeds the README's trade-offs section.
- Sessions end at a clean, committed milestone boundary. To resume: _"Continue the Resonance
  build. Read `PRD.md` and `docs/plan.md`, then pick up from the next unchecked milestone."_

## Environment (recorded 2026-10-10)

| Item               | Value                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------- |
| Machine            | Apple M5, 16 GB RAM, macOS (Darwin 25.6)                                              |
| Node / pnpm        | v22.17.1 / 10.34.6 (pinned through `packageManager`)                                  |
| Rust               | 1.99.0 stable, `wasm32-unknown-unknown`, clippy, rustfmt                              |
| Browser automation | Playwright (Chromium and headless SwiftShader)                                        |
| AWS                | No CLI and no credentials, deliberately. Infra is synth-only until the owner deploys. |

## Milestones

★ marks the MVP cut line.

- [x] **M1 Scaffold.** pnpm + Cargo workspaces, Vite/React/TS strict, WASM build wiring
      (wasm-pack → `vite-plugin-wasm`), COOP/COEP dev and preview headers, ESLint/Prettier/Husky,
      CI skeleton, deterministic fixture generator.
- [x] **M2 Audio pipeline.** IN-1 to IN-8, ER-1, ER-2, ER-3. Covers file playback, 3 real
      bundled songs, mic with an input-device picker (loopback devices), **tab/system capture via
      `getDisplayMedia`** (PRD 5.1.1), live-source health, transport, the AudioWorklet tap, the
      SPSC ring buffer (drop-oldest, overrun counter), and the postMessage fallback transport.
      Also adds `docs/listening-to-other-apps.md`, a user guide per browser and OS.
- [x] **M3 DSP core.** DSP-1 to DSP-5, DSP-10, DSP-11. FFT (checked against rustfft), STFT,
      Slaney mel, six bands with envelopes and auto-gain plus a noise gate, flux onsets, centroid
      and RMS, the feature-frame writer, proptest, criterion, and integration into the DSP worker.
- [x] **M4 Tempo.** DSP-6. Autocorrelation of the onset envelope with a log-Gaussian prior;
      click-track tests at 70, 90, 120, 140, and 174 BPM.
- [x] **M5 Rendering v1.** RD-1, RD-3, RD-4, RD-10, RD-13. Renderer interface, WebGL2 backend,
      Spectral Tunnel, worker → main-thread fallback, seqlock frame reader with interpolation,
      adaptive quality, visibility pause.
- [x] **M6 UI and safety.** UI-1, UI-2, UI-3, UI-5, AX-1 to AX-4, ER-4, ER-5. Controls, debug
      overlay, capability banner, photosensitivity gate, WCAG flash limiter, reduced motion, axe.
- [x] **M7 Timing.** PRD §6.3. Output-clock targeting, A/V sync error and input latency in the
      overlay, `docs/latency.md`.
- [x] **M8 Capture.** RD-11. Deterministic capture mode, `pnpm capture` (screenshots and hero
      GIF), visual regression under SwiftShader.
- [x] **M9 Infra.** (deploy-ready; not deployed: no AWS credentials by design. Steps in docs/deploy.md.) PRD §12. CDK stack (private S3, CloudFront OAC, headers policy, wasm MIME,
      caching), CD workflow over GitHub OIDC, smoke test, bundle budget, Lighthouse CI.
      Deployment steps written down for the owner.
- [x] **M10 ★ Docs and MVP.** (complete except the live deploy, which needs the owner's AWS account) PRD §13. README, architecture, feature-frame, dsp-notes,
      benchmarks (`pnpm bench`), evaluation (`pnpm eval`), ADRs.
- [x] **M11 WebGPU.** RD-2, RD-5, RD-12. WebGPU backend, Particle Nebula, device and context loss.
- [x] **M12 Musical analysis.** DSP-7 to DSP-9, the IN-5 timeline, PRD §9.2. Beat tracker,
      chroma and key, offline analysis worker, seek-bar timeline, accuracy eval.
- [x] **M13 Polish (P1).** RD-7 to RD-9, UI-4. Post-FX, crossfades, beat camera, shortcuts and
      `?` sheet, URL-hash settings.
- [x] **M14 Chroma Bloom (P2).** RD-6, then refresh README numbers, screenshots, and GIF.

## How each milestone is verified

| #      | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1     | `pnpm install` on a clean checkout. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `cargo test` all green. `pnpm dev` serves with the COOP/COEP headers (checked with curl), and a Playwright smoke test asserts `crossOriginIsolated === true` and that the WASM module loads and answers a call. The fixture generator is byte-identical across two runs (hash check).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M2     | proptest on a Rust model of the ring buffer (ordering, capacity, drop-oldest). Vitest on the TS ring buffer. A multi-worker Playwright stress test (producer and consumer workers, millions of samples, checks the sequence and overrun accounting). e2e: start prompt gates the AudioContext; a fixture plays; the oversize-file, unsupported-format, and mic-denied errors render their messages. The non-isolated page runs on the postMessage transport. Tab capture: Chromium launched with `--auto-select-tab-capture-source-by-title` (or `--auto-select-desktop-capture-source`; confirm which the pinned Chromium honours) captures a second Playwright page playing a fixture tone, and the test asserts the expected FFT peak arrives. A mocked stream without an audio track shows the "tick Share tab audio" message. Stopping the track returns to idle. Manual check: YouTube Music in a real Chrome tab. |
| M3     | Rust tests: a sine lands in the expected bin; matches rustfft within 1e-4 relative; Parseval; linearity; inverse round-trip (proptest); Hann sums and mel shapes match reference values. An allocation-counting global allocator proves zero allocations per hop. Criterion benches for FFT 2048, hand-written vs rustfft, and the full hop. In the browser, the DSP worker produces frames whose values Playwright reads back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M4     | Click tracks at 70, 90, 120, 140, and 174 BPM detected within ±2 BPM, with half/double cases counted separately and reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M5     | Playwright on headless Chromium (SwiftShader): the canvas has non-blank pixel variance while a fixture plays. Each fallback is forced with a query flag (`?renderer=main`) and checked. A unit test drives the adaptive-quality controller with synthetic frame times. A visibility-hidden emulation stops the render loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M6     | Vitest for the flash limiter (synthetic luminance series: at most 3 large flashes in any 1 s window; saturated red suppressed). e2e: warning shown once and remembered; `D` toggles an overlay with non-zero FPS, DSP time, and BPM; full keyboard pass; axe reports zero violations; reduced motion is emulated and checked; a WASM load failure is forced and shows the error state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M7     | Sync error computed from `getOutputTimestamp()` against the target time of the presented frame and logged into a histogram. Playwright reads p50/p95 from the overlay. The method and its limits are written up in `docs/latency.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M8     | Two capture runs with the same seed and fixture produce identical frames. The visual regression test passes under SwiftShader within its pixel tolerance. `pnpm capture` writes every screenshot plus an 8-12 s GIF.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| M9     | `cdk synth` succeeds, and CDK assertion tests check OAC, the headers policy, the wasm content type, and cache policies. `actionlint` passes on the workflows. The smoke-test script is exercised against `vite preview` locally. No real deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M10    | Every README number traces to `docs/benchmarks.md` or `docs/evaluation.md`. A fresh-clone run of the README quickstart works in a temp dir.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M11    | WebGPU can't run in headless CI. Verified manually in headed Chrome on the M5 (screenshot and FPS log). Device loss forced via `device.destroy()` and the WebGL `WEBGL_lose_context` extension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M12    | Synthetic chords and scales give the expected chroma peaks and key. `pnpm eval` reports onset and beat F-measure (±70 ms) and tempo Acc1 and Acc2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M13–14 | e2e for shortcuts, URL-hash round-trip, and per-toggle post-FX; screenshots refreshed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Risks

From PRD §15, plus risks specific to this build environment.

| Risk                                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COOP/COEP breaks third-party assets or hosting                                                           | Self-host every asset (fonts, audio, WASM). CloudFront headers policy. postMessage fallback (ER-3).                                                                                                                                                                                                                                                                        |
| WebGPU missing or unstable on a reader's machine                                                         | WebGL2 is the P0 baseline; WebGPU is an enhancement (§6.4).                                                                                                                                                                                                                                                                                                                |
| Headless CI can't run WebGPU or real GPUs                                                                | Visual tests run WebGL2 under SwiftShader. WebGPU is verified manually and documented.                                                                                                                                                                                                                                                                                     |
| Output-latency APIs are estimates                                                                        | Limits documented in `docs/latency.md`; optional camera-based check.                                                                                                                                                                                                                                                                                                       |
| Tempo octave errors on real music                                                                        | Tempo prior (DSP-6); Acc1 and Acc2 reported honestly.                                                                                                                                                                                                                                                                                                                      |
| Large files exhaust memory                                                                               | Stream through the media element; cap size and length (IN-6); mono offline decode.                                                                                                                                                                                                                                                                                         |
| Flashing visuals affect photosensitive users                                                             | Warning, WCAG flash limiter, reduced motion (§5.5).                                                                                                                                                                                                                                                                                                                        |
| Scope creep                                                                                              | P0/P1/P2 tags and the MVP line. No P1 work while any P0 is red.                                                                                                                                                                                                                                                                                                            |
| **Env:** headless audio. Playwright has no audio device, so real-time output timing is unrepresentative. | Use Chromium's fake audio flags for functional tests. Real sync and latency numbers come from a headed run on the owner's machine, labelled as such.                                                                                                                                                                                                                       |
| **Env:** licences of real songs (IN-2)                                                                   | Only tracks whose source page states CC0 or CC BY explicitly (e.g. Free Music Archive, incompetech, ccMixter). The source URL, licence, and download date are recorded in `ATTRIBUTION.md`. No "royalty-free" tracks whose terms forbid redistribution (e.g. the Pixabay licence). Commercial songs are never bundled; users bring those through file drop or tab capture. |
| **Env:** beat annotations for real songs (§9.2)                                                          | I can't tap along by ear. M12 ships the `eval/annotate` tap tool, and the owner taps each song. Until then, real-song rows in `docs/evaluation.md` are marked "not yet annotated", never filled from the detector.                                                                                                                                                         |
| **Env:** tab capture in headless CI                                                                      | Chromium's auto-select flag picks a test tab without the picker. Firefox and Safari can't capture tab audio at all, so the loopback route is documented, not tested in CI.                                                                                                                                                                                                 |
| **Env:** perf numbers come from an M5, faster than the PRD's reference laptop                            | `docs/benchmarks.md` records the exact hardware and notes the gap.                                                                                                                                                                                                                                                                                                         |
| **Env:** bundle budget of 350 KB gzipped (React + WASM)                                                  | Track it from M1. Prefer Preact compat or code-splitting the render worker if it gets tight.                                                                                                                                                                                                                                                                               |

## Needs the owner (manual)

- AWS account, GitHub OIDC role bootstrap, and `cdk deploy` (steps arrive in M9).
- Domain or CloudFront URL for the live demo link.
- Approve the 3 real songs I shortlist in M2 (or suggest your own CC0/CC BY picks).
- Tap beat annotations for those songs with `eval/annotate` (M12, about 10 min per song).
- Check tab capture with YouTube Music in a real Chrome window.
- Review the generated screenshots and GIF.
- WebGPU check on a headed browser (M11), Firefox and Safari passes (§17).

## After the build: GitHub profile update (owner request, 2026-10-10)

Once the project is done, update the owner's GitHub profile landing page (local checkout at
`~/gh-profile`) to feature **Resonance** and **MLSmartLift** (`~/workplace/projects/MLSmartLift`),
each with an image (Resonance: the hero GIF from `pnpm capture`).

- Design reference: https://github.com/ConardLi/garden-skills. Read it before designing.
- It must not look vibecoded: no emoji walls, badge spam, or generic AI-template sections.
  Restrained, deliberate typography and layout.
- Show the owner a preview and get confirmation before pushing (it's public).

## Problem log

Real problems hit during the build and how they were solved. Source for the README trade-offs section.

- **Vite didn't bundle workers created through a helper.** `new Worker(url)` with a URL built
  elsewhere shipped the raw `.ts` file as an asset, and the stress page silently hung. Vite only
  recognises `new Worker(new URL("./x.ts", import.meta.url))` as a single expression. Fixed by
  constructing workers inline at every call site.
- **The postMessage fallback died after one batch.** The worklet transfers each filled batch's
  buffer to the DSP worker, then sized the next batch from the old array, which reads as length
  0 once its buffer is transferred. The next `set()` threw and the processor stopped. Found by
  the `?coi=0` e2e test; fixed by keeping the batch size separately.
- **Short transients vanished from the stats.** Chrome's fake microphone emits a brief beep about
  once a second; reporting the last hop's RMS every 250 ms usually missed it, so the mic test
  was flaky. Stats now report the peak hop RMS over each window, which is also the right input
  for the live-silence detector (IN-8).
- **Headless tab capture is silent.** Full headless Chromium (`channel: "chromium"`) plus
  `--auto-select-tab-capture-source-by-title` does run the real `getDisplayMedia` flow and
  returns an audio track, but the track carries silence: a headless tab has no real audio output
  to tap. The default headless shell rejects `getDisplayMedia` outright. The e2e test verifies
  the wiring; audio content is covered with a mocked stream and checked manually.
- **Note on property tests.** The PCM ring lives in TypeScript (it's shared by the worklet and
  the worker), so its property tests use fast-check, the TypeScript equivalent of proptest.
  proptest covers the Rust DSP.
- **False onsets from beating partials.** On the synthetic groove, spectral flux in dB picked up
  low-level amplitude beating between pad partials about 100 ms after each hi-hat (precision
  0.81). A single flux floor relative to the loudest mel bin fixed precision but floored the
  hats (recall 0.63), because Slaney area normalization puts wide high-frequency bins on a lower
  dB scale. Flooring each bin 40 dB below its own slow peak gives F = 0.98 on both grooves.
  This was tuned on synthetic data; the real-song eval (M12) is the honest check.
- **FFT twiddle layout.** The first radix-2 FFT read twiddles at a stride (`k * n/size`) and
  branched on direction inside the butterfly loop: 7.7 µs for 2048 points, 3x rustfft. Storing
  twiddles stage by stage (contiguous per stage, with a separate conjugate table for the
  inverse) brought it to 5.2 µs. rustfft is still about 2x faster (it uses NEON and mixed
  radices); that's an accepted trade-off for a readable from-scratch FFT.
- **Stale preview server.** Playwright's `reuseExistingServer` silently reused a `vite preview`
  left running from a manual screenshot session, so a whole batch of new UI tests "failed"
  against an old build. The config now always starts its own server.
- **A/V sync error is zero by construction.** With a 100 ms lookahead the renderer can always
  show exactly the frame for the output timestamp, so the PRD's software metric reads 0 ms. The
  real error is in the browser's output-latency estimate and the display, which software can't
  observe. Documented in docs/latency.md, with a calibration mode (`?calibrate=1`) for the camera
  check instead of claiming a number we can't measure.
- **Test audio through the speakers.** Headless runs of the full Chromium build (used for the
  real tab-capture test) can reach the real audio device. All Playwright launches now pass
  `--mute-audio`; timing APIs keep working.
- **`SharedArrayBuffer` is undefined when not isolated.** An `instanceof SharedArrayBuffer` check
  in the clock wiring threw a ReferenceError on non-isolated pages and failed the whole engine
  start in the postMessage fallback. The e2e suite's `?coi=0` runs caught it; the check now keys
  off the negotiated transport instead.
- **The AudioContext froze while the laptop's display was asleep.** With the owner away, macOS
  stopped servicing the built-in output, so Chromium's audio clock (driven by device callbacks)
  stalled after four render quanta: `currentTime` stuck at 10.7 ms, media time at 0, no DSP
  hops. Every audio e2e test failed although nothing in the code had changed. Tests and capture
  now launch Chromium with `--disable-audio-output`, which drives the clock from a timer:
  silent, hardware-independent, and identical in CI.
- **Flaky tests under parallel load.** Chrome's fake microphone beeps only occasionally, so
  asserting on its audio level was flaky; the mic tests now check the real device path for
  wiring and use a stubbed oscillator stream for content. The "no drops at realistic rates" ring
  stress case used a much smaller ring than the app; it now uses the app's 32768-sample ring at
  4x real time. Playwright runs 4 workers locally, since each one software-renders.
- **Film grain made the hero GIF 7.4 MB.** Per-frame noise in every pixel defeats LZW. Capture
  turns grain off for the GIF only and uses one palette per theme segment: 4.8 MB.
- **One header source for tests and production.** COOP, COEP, CORP, CSP, and Permissions-Policy
  live in `packages/web/security-headers.json`; `vite preview` serves them and the CDK response
  headers policy is generated from them. Every e2e run therefore exercises the production CSP.
  That caught two tests injecting `<style>` tags and an inline `<style>` on the capture page,
  which `style-src 'self'` blocks.
- **Lighthouse dropped Time to Interactive.** Lighthouse 10+ no longer reports TTI, so the PRD's
  "TTI < 2 s" budget is enforced through LCP (< 2 s) and Total Blocking Time (< 200 ms).
- **Live input latency missed its target.** The first `pnpm bench` measured 53.6 ms against the
  50 ms goal; most of it was the 2048-sample window's half-width. Live sources now analyse with
  a 1024/256 STFT (35.3 ms); files keep 2048/512 because the lookahead hides their latency.
- **The memory API isn't in the headless shell.** `performance.measureUserAgentSpecificMemory`
  throws in Playwright's headless shell, so the first benchmark couldn't report memory. The
  benchmark now uses full Chromium in new-headless mode, which supports it (and the real GPU).
- **Benchmark variance.** Two full `pnpm bench` runs on the same machine gave a WASM per-hop mean
  of 7.9 µs and 15.1 µs; the second ran while the machine was busy with other work. The README
  quotes the committed run, which is the slower one.
- **A reserved word made the WebGPU nebula silently black.** `target` is reserved in WGSL; the
  shader module failed to compile and every later pipeline call was invalid, with nothing on
  screen and nothing in the console. The backend now logs `uncapturederror` events, which showed
  the problem at once (and a second one: WGSL requires parentheses when mixing `^` and `*`).
- **Headless WebGPU needs ANGLE on SwiftShader to present.** In the headless shell,
  `--enable-unsafe-webgpu` gives a SwiftShader WebGPU adapter, but without
  `--use-angle=swiftshader` the canvas hands out invalid textures. With the flag, the WebGPU path
  (tunnel, GPU nebula, device-loss recovery) runs in CI with no GPU. Page screenshots don't
  reliably include a worker's WebGPU canvas, so those tests read the frame back from the GPU
  through a test-only probe instead.
- **Particles collapsing into streams.** See ADR 0008.
- **WebGPU on Linux CI runners.** GitHub's Ubuntu runners give a SwiftShader WebGPU adapter, but
  the device is lost within seconds and can't be re-created, so the WebGPU e2e project only runs
  on macOS, where both the SwiftShader and Metal adapters pass. The episode exposed a real gap:
  a WebGPU device that can't be rebuilt left the canvas black. The render worker now reports it
  and the host moves rendering to WebGL2 on a fresh canvas. Test probes also time out instead of
  hanging.
- **Beat tracker locked onto the off-beat.** With the all-band flux, the online tracker scored F = 0
  on humanized grooves: perfectly locked, half a beat off, because off-beat hi-hats outweigh the
  kick in all-band flux. A bass-weighted envelope for beat phase fixed it (0.98+). Using it for
  tempo too pulled a real house track to 2/3 tempo, so tempo stays on the all-band flux.
- **Chroma heard the kick drum as C♯.** Low FFT bins are wider than a semitone, and kick energy
  around 70 Hz mapped to C♯ in every frame, so a C-major groove came out as B♭ minor. Chroma now
  starts at 200 Hz.
- **A seam bloom made visible.** The tunnel's ribs were antialiased with `fwidth` on an angle that
  wraps at ±π, so the derivative spiked along one line at the top of the screen. It was faint until
  bloom picked it up as a bright dashed line. Measuring ribs on the mirrored angle (no wrap) fixed
  it in both the GLSL and WGSL versions.
- **Post-processing on both backends.** WebGPU is the default renderer on desktop Chrome, so
  doing bloom and crossfades only on WebGL2 would have hidden them from most visitors. Both
  backends render each mode into a scene texture and share the same bright-pass, separable blur,
  and composite (crossfade, bloom, beat-triggered chromatic aberration, grain).
- **Old audio leaking into a new source.** On the slower CI runner, switching from a track to a
  test tone over the postMessage transport left the previous track's queued batches to be
  analysed after the reset, so the tone's first stats mixed both sources. Reset now drops queued
  batches and skips the shared ring to its newest sample (`RingConsumer.skipToLatest`, unit
  tested), and the test waits for a stats window that is entirely the tone.
- **Banner over the picker.** With Linux font metrics the capability banner overlapped the bottom
  of the source picker and intercepted clicks. The banner now appears once something is playing;
  the top-bar pill shows the active renderer and transport from the start.
- **Tests racing the auto-hiding controls.** On the slower CI runner, steps after playback
  started could take more than the 3 s auto-hide delay, so clicks waited forever on controls with
  `pointer-events: none`. Tests now wake the controls before clicking. Also: a stats window with
  no rendered frames (software rendering with bloom on a 2-core runner) used to report 0 ms lead
  and sync; the core now keeps the last real reading, and adaptive quality drops bloom before it
  drops resolution.

## After the PRD (2026-10-12)

Owner requests:

- **Colours follow the tempo.** A "Follow the tempo" theme (now the default) interpolates
  between five anchor palettes by BPM, easing toward the current tempo with a 3 s time
  constant so estimates settling never flicker the colours. Unit tests check smoothness, the
  slow/house/fast character, and that no tempo produces saturated red (AX-2). The first anchors
  interpolated a hue phase from 0.0 to 0.9 the long way round the colour wheel (a visible jump
  between 124 and 140 BPM); phases are now written as continuous values.
- **House on YouTube.** 15 popular house tracks in the source picker, each verified with
  YouTube's oEmbed endpoint as an upload on the artist's official, VEVO, or Topic channel. A track
  opens in a new tab, and the picker then offers "Capture that tab" (IN-4). A box also takes any
  pasted YouTube link or a search. Resonance never loads YouTube itself. e2e tests stub YouTube
  and check the opened URLs and the capture flow.
