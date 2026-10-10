# ADR 0002: PCM ring buffer with consumer-side drop-oldest

- Status: accepted
- Date: 2026-10-10

## Context

The AudioWorklet must hand every render quantum (128 samples, about 2.7 ms) to the DSP worker
without blocking, allocating, or posting a message per block (PRD 6.2). When the consumer falls
behind, the PRD asks for the _oldest_ data to be dropped and counted, so analysis always resumes
on the newest audio.

The usual SPSC ring drops the _newest_ data (the producer refuses to write when full). Dropping
the oldest normally means the producer advances the read index, which breaks the
one-writer-per-index property and needs a CAS loop on the audio thread.

## Decision

Each side writes only its own index. The producer always writes and publishes `write` with
`Atomics.store`, overwriting old samples when the ring is full. It never reads `read`. The
consumer detects overwrites itself:

1. **Skip ahead:** if more than `capacity - margin` samples are pending, jump to the newest
   `capacity - margin`.
2. **Validate after copy:** re-read `write`. Any copied sample the producer could have reached
   during the copy, including the chunk it may be writing right now (up to `margin` samples), is
   discarded as possibly torn.

Both cases are added to an overrun counter in the shared header, shown in the debug overlay.

`margin` is the largest chunk the producer writes in one call (1024 samples, well above the
128-sample quantum). Indices are 32-bit wrapping counters with unsigned arithmetic. The consumer
also tracks a float64 absolute index, so every sample maps to the audio-context frame it was
captured at: `startFrame + index`. The worklet writes a block every quantum, silent or not, so
that mapping never drifts.

## Consequences

- The audio thread does one copy loop, one `Atomics.store`, and one `Atomics.notify` per block.
  No CAS, no retry, no allocation.
- The consumer sometimes discards samples that were actually fine (the margin is conservative).
  That only happens when it's already more than `capacity - margin` behind, so it never costs
  anything in normal operation.
- Verified by property tests (fast-check, the TypeScript counterpart of proptest; random
  push/read interleavings and starting indices near 2^32) and a three-regime multi-worker stress
  test in a real browser: paced at 10x real time (zero drops), flooded, and a stalled consumer.
  The stress test checks every delivered sample equals its stream index, and that
  consumed + dropped == produced.
