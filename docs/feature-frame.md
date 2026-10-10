# Feature frame (schema v1)

The DSP worker publishes one feature frame per hop: 512 samples for files (10.7 ms at 48 kHz,
11.6 ms at 44.1 kHz) and 256 for live input, which analyses with a 1024-sample window to cut
latency. The layout is fixed and versioned. It's defined twice, in
`crates/dsp/src/frame.rs` (writer) and `packages/web/src/lib/frames.ts` (readers), and a Vitest
test compares the two through the WASM export `frameOffsets()`. The analyzer refuses to start if
`schemaVersion()` or `frameFloats()` disagree with the app.

## Slot layout (frame bus)

Each slot in the frame bus is 480 bytes:

| Byte offset | Type      | Field       | Notes                                                             |
| ----------- | --------- | ----------- | ----------------------------------------------------------------- |
| 0           | i32       | sequence    | Seqlock counter: odd while being written                          |
| 4           | i32       | (padding)   |                                                                   |
| 8           | f64       | frame index | Hops since the analyzer started                                   |
| 16          | f64       | timestamp   | Audio-context sample position of the analysis window's **centre** |
| 24          | 8 bytes   | (padding)   |                                                                   |
| 32          | f32 x 112 | payload     | Below                                                             |

Bus header (64 bytes, i32): magic `0x52534E43` ("RSNC"), schema version, slot count, newest frame
index (-1 when empty), sample rate, hop.

## Payload (112 x f32)

| Offset | Count | Field                 | Range     | Meaning                                                                                                                                                             |
| ------ | ----- | --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | 6     | bands                 | 0..1      | Sub-bass 20-60 Hz, bass 60-250, low-mid 250-500, mid 500-2k, high-mid 2k-4k, treble 4k-16k. Energy in dB, auto-gained, with an instant-attack/slow-release envelope |
| 6      | 64    | mel                   | 0..1      | Slaney mel bands 30 Hz to min(16 kHz, Nyquist), log power, per-band auto-gain capped 30 dB above the loudest band                                                   |
| 70     | 1     | flux                  | >= 0      | Onset strength: mean positive rise of the log-mel spectrum (dB) / 6                                                                                                 |
| 71     | 1     | onset                 | 0 or 1    | An onset was detected at the **previous** frame (peak picking needs one frame of look-ahead)                                                                        |
| 72     | 1     | bpm                   | 60-180, 0 | Tempo estimate; 0 until about 3 s of audio                                                                                                                          |
| 73     | 1     | tempo confidence      | 0..1      | (best score - mean score) / best score                                                                                                                              |
| 74     | 1     | beat phase            | 0..1      | Position within the current beat (P1, DSP-7; 0 for now)                                                                                                             |
| 75     | 1     | beat                  | 0 or 1    | Predicted beat (P1)                                                                                                                                                 |
| 76     | 12    | chroma                | 0..1      | Pitch classes C..B (P1, DSP-8)                                                                                                                                      |
| 88     | 1     | key                   | -1, 0-23  | 0-11 major C..B, 12-23 minor C..B, -1 unknown (P1)                                                                                                                  |
| 89     | 1     | key confidence        | 0..1      | (P1)                                                                                                                                                                |
| 90     | 1     | centroid              | Hz        | Spectral centroid (magnitude-weighted)                                                                                                                              |
| 91     | 1     | centroid (normalized) | 0..1      | log2(centroid / 50 Hz) / log2(16 kHz / 50 Hz), gated                                                                                                                |
| 92     | 1     | rms                   | linear    | RMS of the analysis frame, before any gain                                                                                                                          |
| 93     | 1     | loudness              | 0..1      | Auto-gained level, gated                                                                                                                                            |
| 94     | 1     | gate                  | 0 or 1    | Noise gate open (level above -57 dBFS; closes below -62)                                                                                                            |
| 95     | 17    | reserved              |           | Zero                                                                                                                                                                |

"Gated" fields fade to zero (250 ms release) while the noise gate is closed, so silence and room
noise never get amplified into visuals (ER-4).

## Timestamps

`timestamp` is the window centre: `endOfWindow - frameSize / 2`. With the default 2048-sample
frame, the centre trails the newest analysed sample by 1024 samples (21 ms at 48 kHz). The
renderer compares this timestamp with the audio output clock to pick and interpolate frames
([latency.md](latency.md)).

## Versioning

Any change to offsets, field meanings, or the slot layout bumps `FRAME_SCHEMA_VERSION` in both
`frame.rs` and `frames.ts`. Reserved floats exist so P1 fields can be added without moving
anything.
