# ADR 0004: DSP in Rust compiled to WebAssembly

- Status: accepted
- Date: 2026-10-10

## Context

Each hop runs an FFT, a 64-band filterbank, onset detection, and periodically an autocorrelation.
It has to finish well inside 10.7 ms (one hop at 48 kHz) on mid-range laptops and phones, every
hop, without GC pauses. The same code also has to run natively for tests, property tests,
benchmarks against `rustfft`, and the accuracy eval.

Options considered:

- **TypeScript in the worker.** Simple to ship, but numeric code on the JS heap is subject to GC
  and JIT deoptimization, and a native test/benchmark story would need a second implementation.
- **AnalyserNode.** Built in, but it hides the window, the FFT, and timing (no timestamps, fixed
  smoothing), which is the opposite of what this project is meant to demonstrate. The PRD rules
  it out.
- **Rust → WASM.** One implementation for the browser, native tests, criterion, and eval;
  predictable performance; no GC.

## Decision

All analysis lives in `crates/dsp` (no dependencies). `crates/dsp-wasm` is a thin
`wasm-bindgen` layer that exposes raw pointers to the analyzer's input and frame buffers, so the
worker writes samples into WASM memory and reads frames from it in place. Nothing crosses the
JS/WASM boundary except one `process()` call per hop. All buffers are allocated in the
constructor; a counting-allocator test enforces zero allocations per hop.

## Consequences

- The hot path in the browser takes tens of microseconds per hop
  ([benchmarks.md](../benchmarks.md)), about 0.2% of the time budget.
- A Rust toolchain plus `wasm-pack` is needed to build the web app. CI installs both.
- The FFT is hand-written for clarity and verified against `rustfft`, which stays a
  dev-dependency only. It's about 2x slower than rustfft (NEON, mixed radix), which doesn't
  matter at this budget.
