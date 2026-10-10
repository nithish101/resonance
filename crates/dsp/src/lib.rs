//! Resonance DSP: the real-time music analysis pipeline, compiled to WebAssembly for the
//! browser and natively for tests and benchmarks.
//!
//! Pipeline per hop: STFT (Hann, [`fft::RealFft`]) → power spectrum → 64-band Slaney mel
//! ([`mel::MelBank`]) → six band energies with envelopes and auto-gain → spectral-flux onsets
//! ([`onset::OnsetDetector`]) → autocorrelation tempo ([`tempo::TempoEstimator`]) → centroid and loudness → one fixed-layout feature frame
//! ([`frame`]). See docs/dsp-notes.md for the maths and the reasoning behind each parameter.

pub mod analyzer;
pub mod complex;
pub mod envelope;
pub mod eval;
pub mod fft;
pub mod frame;
pub mod mel;
pub mod offline;
pub mod onset;
pub mod tempo;
pub mod window;

pub use analyzer::{Analyzer, Config};
pub use complex::Complex;

/// Version of the feature-frame layout. Bump on any change to [`frame`].
pub const FRAME_SCHEMA_VERSION: u32 = 1;
