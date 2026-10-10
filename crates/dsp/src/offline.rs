//! Runs the real-time analyzer over a whole signal. Used by tests, the eval runner, and
//! benchmarks; produces exactly the frames the browser would.

use crate::analyzer::{Analyzer, Config};
use crate::frame::{FRAME_FLOATS, ONSET};

pub struct OfflineResult {
    pub frames: Vec<[f32; FRAME_FLOATS]>,
    /// Centre of each frame's analysis window, in seconds from the start of the signal.
    pub times: Vec<f64>,
    /// Onset times in seconds. The detector flags an onset one hop after it happens (peak
    /// picking needs the next value), so each flag is attributed to the previous frame.
    pub onsets: Vec<f64>,
}

pub fn analyze(mono: &[f32], cfg: Config) -> OfflineResult {
    let mut a = Analyzer::new(cfg);
    let hop = cfg.hop;
    let sr = cfg.sample_rate as f64;
    let mut frames = Vec::with_capacity(mono.len() / hop);
    let mut times = Vec::with_capacity(mono.len() / hop);
    let mut onsets = Vec::new();
    for (i, chunk) in mono.chunks_exact(hop).enumerate() {
        a.input_mut().copy_from_slice(chunk);
        a.process();
        let end = ((i + 1) * hop) as f64;
        let t = (end - cfg.frame_size as f64 / 2.0) / sr;
        if a.frame()[ONSET] > 0.5 {
            onsets.push(t - hop as f64 / sr);
        }
        frames.push(*a.frame());
        times.push(t);
    }
    OfflineResult {
        frames,
        times,
        onsets,
    }
}
