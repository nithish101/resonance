//! Feature-frame layout (PRD 5.2 output contract). Must match `packages/web/src/lib/frames.ts`;
//! a Vitest test compares the two through the WASM export `frameOffsets()`. Documented in
//! docs/feature-frame.md.

pub const BANDS: usize = 6;
pub const MEL_BANDS: usize = 64;
pub const CHROMA: usize = 12;

pub const BANDS_AT: usize = 0;
pub const MEL_AT: usize = 6;
pub const FLUX: usize = 70;
pub const ONSET: usize = 71;
pub const BPM: usize = 72;
pub const TEMPO_CONFIDENCE: usize = 73;
pub const BEAT_PHASE: usize = 74;
pub const BEAT: usize = 75;
pub const CHROMA_AT: usize = 76;
pub const KEY: usize = 88;
pub const KEY_CONFIDENCE: usize = 89;
pub const CENTROID: usize = 90;
pub const CENTROID_NORM: usize = 91;
pub const RMS: usize = 92;
pub const LOUDNESS: usize = 93;
pub const GATE: usize = 94;
/// Bass-weighted onset strength that drives tempo and beats (schema v2).
pub const BEAT_STRENGTH: usize = 95;

/// Total floats per frame; 96..112 are reserved for future fields.
pub const FRAME_FLOATS: usize = 112;

/// Offsets in the same order as the `F` table in frames.ts.
pub const OFFSETS: [usize; 17] = [
    BANDS_AT,
    MEL_AT,
    FLUX,
    ONSET,
    BPM,
    TEMPO_CONFIDENCE,
    BEAT_PHASE,
    BEAT,
    CHROMA_AT,
    KEY,
    KEY_CONFIDENCE,
    CENTROID,
    CENTROID_NORM,
    RMS,
    LOUDNESS,
    GATE,
    BEAT_STRENGTH,
];

/// Frequency edges (Hz) of the six bands: sub-bass, bass, low-mid, mid, high-mid, treble.
pub const BAND_EDGES_HZ: [f32; BANDS + 1] = [20.0, 60.0, 250.0, 500.0, 2000.0, 4000.0, 16000.0];
