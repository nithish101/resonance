# ADR 0001: WASM build and loading

- Status: accepted
- Date: 2026-10-10

## Context

The DSP runs as Rust compiled to WebAssembly inside a module Web Worker (PRD 5.2, 7). The PRD
lists `vite-plugin-wasm`; it exists to support the ESM-integration style
(`import { f } from "./x.wasm"`), which wasm-pack's `bundler` target emits.

PRD 7 also asks for WASM SIMD where available, with a scalar fallback.

## Decision

- Build with `wasm-pack --target web`. The generated glue loads its `.wasm` through
  `new URL("dsp_bg.wasm", import.meta.url)`, which Vite already understands as an asset in
  both the main bundle and worker bundles. No Vite plugin is needed, so we don't use
  `vite-plugin-wasm`.
- Build the crate twice (`scripts/build-wasm.mjs`): with `-C target-feature=+simd128` and
  without. Each build uses its own `CARGO_TARGET_DIR` so neither invalidates the other's cache.
- At runtime, `WebAssembly.validate` on a 31-byte module containing one SIMD instruction picks
  the build. Both are dynamic imports, so the browser downloads only the one it uses.

## Consequences

- One fewer build plugin, and identical loading code in the worker and in Vitest/Node.
- Build time roughly doubles for the WASM step (a few seconds in release).
- SIMD comes from LLVM auto-vectorization of plain Rust loops, not hand-written intrinsics.
  `docs/benchmarks.md` reports both builds so the gain is measured, not assumed.
