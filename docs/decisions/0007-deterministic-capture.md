# ADR 0007: Screenshots, GIF, and visual tests from a deterministic capture mode

- Status: accepted
- Date: 2026-10-10

## Context

README screenshots and a hero GIF tend to be hand-picked screen recordings that nobody can
reproduce. Visual regression tests need identical pixels across runs and machines. A real-time
render loop is driven by wall-clock time, refresh rate, and when frames happen to arrive, so it
can't give either.

## Decision

- All time-varying visual state (travel distance, onset pulse, smoothed bass, flash limiter
  windows, grain seed) is a function of **audio time**, advanced by `RenderCore.step(time)`.
- `capture.html` decodes the file with an `OfflineAudioContext` at a fixed 48 kHz, runs the same
  WASM analyzer over every hop, writes all frames into a frame bus sized to the whole track, and
  exposes `renderAt(t)`. That call advances the state in fixed steps (1/fps) up to `t`, then draws.
- `pnpm capture` uses it for every mode screenshot and the GIF. The visual regression suite
  renders fixed moments of a fixture under SwiftShader and compares them with committed goldens
  (1% pixel tolerance). A determinism test renders the same moment in two fresh pages and
  requires byte-identical output.
- UI screenshots (debug overlay, settings, fallback banner) come from the live app, because their
  point is real readings. That's documented next to them.

## Consequences

- Screenshots are reproducible and honest. The same script regenerates them after any visual
  change.
- Software rendering (SwiftShader) is slow, but capture renders on demand, so speed doesn't
  matter. It also makes CI results independent of the runner's GPU.
- Goldens are shared across macOS and Linux: SwiftShader, the decoder, and WASM float maths are
  deterministic for a pinned Chromium. If a Chromium upgrade shifts pixels, the goldens are
  regenerated deliberately and the diff reviewed.
