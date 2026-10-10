# ADR 0005: Seqlock-protected slots for feature frames

- Status: accepted
- Date: 2026-10-10

## Context

The DSP worker produces one ~450-byte feature frame per hop. The renderer reads at display rate
(60-144 Hz), needs the two frames that bracket its target time, and must never stall the DSP
worker or be stalled by it. There's one writer and possibly several readers (render worker,
debug overlay on the main thread).

Options considered:

- **postMessage per frame.** Each message is a structured clone and a task on the receiver's
  event loop, so delivery jitter depends on what else that thread is doing. It's kept as the
  fallback transport (ER-3).
- **A mutex built on `Atomics.wait`.** Readers would block the writer and the other way round,
  and `Atomics.wait` isn't allowed on the main thread at all.
- **Triple buffering.** Lock-free, but gives readers only the latest frame. Interpolating at an
  arbitrary target time needs history.
- **A ring of slots, each guarded by a seqlock.** One writer, any number of readers, nobody
  waits, history is available.

## Decision

A `SharedArrayBuffer` holds 128 slots. To write slot `i % 128`, the DSP worker increments the
slot's sequence counter with `Atomics.add` (odd means a write is in progress), writes the payload
with ordinary typed-array stores, stores the counter +1 (even), then publishes the newest index.
A reader loads the counter, retries if it's odd, copies the payload, and reloads the counter. If
the counter changed it discards the copy and retries, up to 4 times, then reports the frame as
unavailable.

`Atomics` operations are sequentially consistent in the JavaScript memory model, so the copy is
bracketed by two synchronizing loads. A racing read can observe mixed bytes, but then the
counters differ and the copy is discarded. The same class runs over a plain `ArrayBuffer` in the
postMessage fallback, so readers have one code path.

## Consequences

- Readers never block the writer and never wait for it. At 93.75 frames/s and a few reads per
  render frame, retries are very rare.
- History is bounded: frames older than 127 hops (1.4 s at 48 kHz) are gone. The file-mode
  lookahead (100 ms) is well inside that.
- Verified by a multi-worker stress test: one writer, three readers, 200,000 frames, every float
  of every accepted frame checked for consistency. Zero torn frames were accepted.
