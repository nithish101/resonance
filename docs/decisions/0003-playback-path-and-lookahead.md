# ADR 0003: Stream files through a media element, with an analysis lookahead

- Status: accepted
- Date: 2026-10-10

## Context

Decoding a whole file with `decodeAudioData` holds the entire track as float32 PCM: about
230 MB for 10 minutes of stereo at 48 kHz (PRD 5.1, 15). Files are also known in advance, so
the visuals can line up with what the listener hears instead of trailing it (PRD 6.3).

## Decision

- Files and bundled tracks play through `HTMLAudioElement` → `MediaElementAudioSourceNode`, which
  streams and decodes incrementally. Seeking uses HTTP range requests (bundled tracks) or the
  in-memory blob (user files).
- The source feeds two branches: the analysis tap directly, and the speakers through a
  `DelayNode` (the _lookahead_, default 100 ms) and the volume gain. Analysis therefore runs
  ahead of what's audible, and the renderer can show the frame for the moment being heard right
  now (details and measurements in `docs/latency.md`).
- Volume sits after the tap, so turning it down doesn't change what's analysed.
- Live sources (mic, tab, system) go only to the tap. The future is unknown there, so the goal is
  minimum latency, and routing a captured tab back to the speakers would double its audio.
- A media element can have only one `MediaElementAudioSourceNode` ever, so the engine keeps one
  element and swaps its `src`.

## Consequences

- Constant memory regardless of track length. The 15-minute / 100 MB limits (IN-6) exist to
  bound the separate mono offline decode used for beat-grid analysis (DSP-9, P1), not playback.
- File mode adds 100 ms between pressing play and hearing sound. That's imperceptible for
  play/pause, and it's what lets visuals land on the beat rather than after it.
