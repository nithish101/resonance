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
- Sessions end at a clean, committed milestone boundary. To resume: *"Continue the Resonance
  build. Read `PRD.md` and `docs/plan.md`, then pick up from the next unchecked milestone."*

## Environment (recorded 2026-10-10)

| Item | Value |
|---|---|
| Machine | Apple M5, 16 GB RAM, macOS (Darwin 25.6) |
| Node / pnpm | v22.17.1 / 10.34.6 (pinned through `packageManager`) |
| Rust | 1.99.0 stable, `wasm32-unknown-unknown`, clippy, rustfmt |
| Browser automation | Playwright (Chromium and headless SwiftShader) |
| AWS | No CLI and no credentials, deliberately. Infra is synth-only until the owner deploys. |

## Milestones

★ marks the MVP cut line.

- [ ] **M1 Scaffold.** pnpm + Cargo workspaces, Vite/React/TS strict, WASM build wiring
      (wasm-pack → `vite-plugin-wasm`), COOP/COEP dev and preview headers, ESLint/Prettier/Husky,
      CI skeleton, deterministic fixture generator.
- [ ] **M2 Audio pipeline.** IN-1, IN-2, IN-3, IN-5, IN-6, IN-7, ER-1, ER-2, ER-3. Covers file,
      bundled-track, and mic sources, transport, the AudioWorklet tap, the SPSC ring buffer
      (drop-oldest, overrun counter), and the postMessage fallback transport.
- [ ] **M3 DSP core.** DSP-1 to DSP-5, DSP-10, DSP-11. FFT (checked against rustfft), STFT,
      Slaney mel, six bands with envelopes and auto-gain plus a noise gate, flux onsets, centroid
      and RMS, the feature-frame writer, proptest, criterion, and integration into the DSP worker.
- [ ] **M4 Tempo.** DSP-6. Autocorrelation of the onset envelope with a log-Gaussian prior;
      click-track tests at 70, 90, 120, 140, and 174 BPM.
- [ ] **M5 Rendering v1.** RD-1, RD-3, RD-4, RD-10, RD-13. Renderer interface, WebGL2 backend,
      Spectral Tunnel, worker → main-thread fallback, seqlock frame reader with interpolation,
      adaptive quality, visibility pause.
- [ ] **M6 UI and safety.** UI-1, UI-2, UI-3, UI-5, AX-1 to AX-4, ER-4, ER-5. Controls, debug
      overlay, capability banner, photosensitivity gate, WCAG flash limiter, reduced motion, axe.
- [ ] **M7 Timing.** PRD §6.3. Output-clock targeting, A/V sync error and input latency in the
      overlay, `docs/latency.md`.
- [ ] **M8 Capture.** RD-11. Deterministic capture mode, `pnpm capture` (screenshots and hero
      GIF), visual regression under SwiftShader.
- [ ] **M9 Infra.** PRD §12. CDK stack (private S3, CloudFront OAC, headers policy, wasm MIME,
      caching), CD workflow over GitHub OIDC, smoke test, bundle budget, Lighthouse CI.
      Deployment steps written down for the owner.
- [ ] **M10 ★ Docs and MVP.** PRD §13. README, architecture, feature-frame, dsp-notes,
      benchmarks (`pnpm bench`), evaluation (`pnpm eval`), ADRs.
- [ ] **M11 WebGPU.** RD-2, RD-5, RD-12. WebGPU backend, Particle Nebula, device and context loss.
- [ ] **M12 Musical analysis.** DSP-7 to DSP-9, the IN-5 timeline, PRD §9.2. Beat tracker,
      chroma and key, offline analysis worker, seek-bar timeline, accuracy eval.
- [ ] **M13 Polish (P1).** RD-7 to RD-9, IN-4, UI-4. Post-FX, crossfades, beat camera, tab
      audio, shortcuts and `?` sheet, URL-hash settings.
- [ ] **M14 Chroma Bloom (P2).** RD-6, then refresh README numbers, screenshots, and GIF.

## How each milestone is verified

| # | Verification |
|---|---|
| M1 | `pnpm install` on a clean checkout. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `cargo test` all green. `pnpm dev` serves with the COOP/COEP headers (checked with curl), and a Playwright smoke test asserts `crossOriginIsolated === true` and that the WASM module loads and answers a call. The fixture generator is byte-identical across two runs (hash check). |
| M2 | proptest on a Rust model of the ring buffer (ordering, capacity, drop-oldest). Vitest on the TS ring buffer. A multi-worker Playwright stress test (producer and consumer workers, millions of samples, checks the sequence and overrun accounting). e2e: start prompt gates the AudioContext; a fixture plays; the oversize-file, unsupported-format, and mic-denied errors render their messages. The non-isolated page runs on the postMessage transport. |
| M3 | Rust tests: a sine lands in the expected bin; matches rustfft within 1e-4 relative; Parseval; linearity; inverse round-trip (proptest); Hann sums and mel shapes match reference values. An allocation-counting global allocator proves zero allocations per hop. Criterion benches for FFT 2048, hand-written vs rustfft, and the full hop. In the browser, the DSP worker produces frames whose values Playwright reads back. |
| M4 | Click tracks at 70, 90, 120, 140, and 174 BPM detected within ±2 BPM, with half/double cases counted separately and reported. |
| M5 | Playwright on headless Chromium (SwiftShader): the canvas has non-blank pixel variance while a fixture plays. Each fallback is forced with a query flag (`?renderer=main`) and checked. A unit test drives the adaptive-quality controller with synthetic frame times. A visibility-hidden emulation stops the render loop. |
| M6 | Vitest for the flash limiter (synthetic luminance series: at most 3 large flashes in any 1 s window; saturated red suppressed). e2e: warning shown once and remembered; `D` toggles an overlay with non-zero FPS, DSP time, and BPM; full keyboard pass; axe reports zero violations; reduced motion is emulated and checked; a WASM load failure is forced and shows the error state. |
| M7 | Sync error computed from `getOutputTimestamp()` against the target time of the presented frame and logged into a histogram. Playwright reads p50/p95 from the overlay. The method and its limits are written up in `docs/latency.md`. |
| M8 | Two capture runs with the same seed and fixture produce identical frames. The visual regression test passes under SwiftShader within its pixel tolerance. `pnpm capture` writes every screenshot plus an 8-12 s GIF. |
| M9 | `cdk synth` succeeds, and CDK assertion tests check OAC, the headers policy, the wasm content type, and cache policies. `actionlint` passes on the workflows. The smoke-test script is exercised against `vite preview` locally. No real deploy. |
| M10 | Every README number traces to `docs/benchmarks.md` or `docs/evaluation.md`. A fresh-clone run of the README quickstart works in a temp dir. |
| M11 | WebGPU can't run in headless CI. Verified manually in headed Chrome on the M5 (screenshot and FPS log). Device loss forced via `device.destroy()` and the WebGL `WEBGL_lose_context` extension. |
| M12 | Synthetic chords and scales give the expected chroma peaks and key. `pnpm eval` reports onset and beat F-measure (±70 ms) and tempo Acc1 and Acc2. |
| M13–14 | e2e for shortcuts, URL-hash round-trip, and per-toggle post-FX; screenshots refreshed. |

## Risks

From PRD §15, plus risks specific to this build environment.

| Risk | Mitigation |
|---|---|
| COOP/COEP breaks third-party assets or hosting | Self-host every asset (fonts, audio, WASM). CloudFront headers policy. postMessage fallback (ER-3). |
| WebGPU missing or unstable on a reader's machine | WebGL2 is the P0 baseline; WebGPU is an enhancement (§6.4). |
| Headless CI can't run WebGPU or real GPUs | Visual tests run WebGL2 under SwiftShader. WebGPU is verified manually and documented. |
| Output-latency APIs are estimates | Limits documented in `docs/latency.md`; optional camera-based check. |
| Tempo octave errors on real music | Tempo prior (DSP-6); Acc1 and Acc2 reported honestly. |
| Large files exhaust memory | Stream through the media element; cap size and length (IN-6); mono offline decode. |
| Flashing visuals affect photosensitive users | Warning, WCAG flash limiter, reduced motion (§5.5). |
| Scope creep | P0/P1/P2 tags and the MVP line. No P1 work while any P0 is red. |
| **Env:** headless audio. Playwright has no audio device, so real-time output timing is unrepresentative. | Use Chromium's fake audio flags for functional tests. Real sync and latency numbers come from a headed run on the owner's machine, labelled as such. |
| **Env:** sourcing bundled tracks and annotations (IN-2, §9.2). I can't verify licences of downloaded music or hand-annotate beats by ear. | The bundled tracks are original procedural compositions generated by `scripts/` and released CC0 by this repo, so licensing is unambiguous and beat ground truth is exact. Real CC0 tracks with hand-made annotations need the owner (see below); until then `docs/evaluation.md` says plainly that the dataset is synthetic. |
| **Env:** perf numbers come from an M5, faster than the PRD's reference laptop | `docs/benchmarks.md` records the exact hardware and notes the gap. |
| **Env:** bundle budget of 350 KB gzipped (React + WASM) | Track it from M1. Prefer Preact compat or code-splitting the render worker if it gets tight. |

## Needs the owner (manual)

- AWS account, GitHub OIDC role bootstrap, and `cdk deploy` (steps arrive in M9).
- Domain or CloudFront URL for the live demo link.
- Optional: a few real CC0 tracks plus hand-tapped beat annotations for the eval set.
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

- *(empty)*
