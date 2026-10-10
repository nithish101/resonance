# ADR 0006: Render in a worker, with a fallback chain decided once

- Status: accepted
- Date: 2026-10-10

## Context

React re-renders, layout, and GC on the main thread cause frame drops if the visuals render
there. `OffscreenCanvas` lets a worker own the canvas, but support differs (WebGL2 in workers
arrived later in Safari), WebGPU isn't everywhere, and some environments block workers or
`SharedArrayBuffer`.

## Decision

- Rendering logic (`render/core.ts`, `render/loop.ts`, backends) is environment-agnostic and runs
  unchanged in the render worker or on the main thread.
- At startup, `detectCapabilities()` probes once, and `RenderHost` picks the first option that
  works: WebGPU worker (P1) → WebGL2 worker → WebGL2 main thread. If the worker reports an error
  during init, the host terminates it and starts the main-thread path on a fresh canvas (a
  transferred canvas can't be reclaimed).
- The choice and the reason are shown in the capability pill and banner (UI-5) and in the debug
  overlay. `?renderer=main` forces the fallback for testing.
- Visual state depends on audio time, not wall-clock time, so every path, including capture
  mode, draws the same thing.

## Consequences

- Main-thread work during playback is limited to React updates at 4 Hz and one clock sample per
  animation frame. `pnpm bench` counts main-thread long tasks during playback.
- Every capability path is covered by e2e tests (worker, forced main thread, postMessage
  transport).
- Two copies of the canvas logic aren't needed, but resize and visibility messages have to be
  forwarded to the worker. `RenderHost.post` hides that difference.
