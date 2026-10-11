//! Runs the real-time analyzer over a whole signal. Used by tests, the eval runner, the offline
//! analysis worker (DSP-9), and benchmarks; produces exactly the frames the browser would.

use crate::analyzer::{Analyzer, Config};
use crate::beatgrid::beat_grid;
use crate::frame::{BEAT_STRENGTH, BPM, CHROMA, CHROMA_AT, FRAME_FLOATS, ONSET, RMS};

pub struct OfflineResult {
    pub frames: Vec<[f32; FRAME_FLOATS]>,
    /// Centre of each frame's analysis window, in seconds from the start of the signal.
    pub times: Vec<f64>,
    /// Onset times in seconds. The detector flags an onset one hop after it happens (peak
    /// picking needs the next value), so each flag is attributed to the previous frame.
    pub onsets: Vec<f64>,
    /// Beats emitted by the online tracker (DSP-7), in seconds.
    pub beats: Vec<f64>,
}

impl OfflineResult {
    fn frame_time(cfg: &Config, frame: f64) -> f64 {
        ((frame + 1.0) * cfg.hop as f64 - cfg.frame_size as f64 / 2.0) / cfg.sample_rate as f64
    }
}

pub fn analyze(mono: &[f32], cfg: Config) -> OfflineResult {
    let mut a = Analyzer::new(cfg);
    let hop = cfg.hop;
    let sr = cfg.sample_rate as f64;
    let mut frames = Vec::with_capacity(mono.len() / hop);
    let mut times = Vec::with_capacity(mono.len() / hop);
    let mut onsets = Vec::new();
    let mut beats = Vec::new();
    for (i, chunk) in mono.chunks_exact(hop).enumerate() {
        a.input_mut().copy_from_slice(chunk);
        a.process();
        let t = OfflineResult::frame_time(&cfg, i as f64);
        if a.frame()[ONSET] > 0.5 {
            onsets.push(t - hop as f64 / sr);
        }
        if let Some(bf) = a.beat_frame() {
            beats.push(OfflineResult::frame_time(&cfg, bf));
        }
        frames.push(*a.frame());
        times.push(t);
    }
    OfflineResult {
        frames,
        times,
        onsets,
        beats,
    }
}

/// Whole-file analysis for files (DSP-9): what the seek bar and the anticipating visuals need.
pub struct FileSummary {
    /// Median tempo over the track's analysed frames (0 if none).
    pub bpm: f32,
    /// Beat grid in seconds, from dynamic programming over the whole onset envelope.
    pub beats: Vec<f64>,
    /// Key index (0-11 major, 12-23 minor; -1 unknown) from the whole track's mean chroma.
    pub key: i32,
    pub key_confidence: f32,
    /// Loudness envelope, `points` values in 0..1 spread evenly over the track.
    pub energy: Vec<f32>,
}

pub fn summarize(mono: &[f32], cfg: Config, points: usize) -> FileSummary {
    let r = analyze(mono, cfg);
    let n = r.frames.len();
    // Tempo: median of the frames that have an estimate.
    let mut bpms: Vec<f32> = r
        .frames
        .iter()
        .map(|f| f[BPM])
        .filter(|&b| b > 0.0)
        .collect();
    bpms.sort_by(f32::total_cmp);
    let bpm = bpms.get(bpms.len() / 2).copied().unwrap_or(0.0);

    let flux: Vec<f32> = r.frames.iter().map(|f| f[BEAT_STRENGTH]).collect();
    let beats = if bpm > 0.0 {
        let period = 60.0 * cfg.hop_rate() as f64 / bpm as f64;
        beat_grid(&flux, period)
            .into_iter()
            // Flux index i is the rise ending at frame i, which is the onset frame itself (only
            // the detector's *flag* lags a hop), so beat i maps straight to frame i's time.
            .map(|b| OfflineResult::frame_time(&cfg, b))
            .collect()
    } else {
        Vec::new()
    };

    let mut chroma = [0.0f32; 12];
    for f in &r.frames {
        for (c, v) in chroma.iter_mut().zip(&f[CHROMA_AT..CHROMA_AT + CHROMA]) {
            *c += v;
        }
    }
    let (key, best, second) = crate::chroma::estimate_key(&chroma);
    let key_confidence = if n > 0 {
        ((best - second) / best.abs().max(1e-6) * 4.0).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut energy = vec![0.0f32; points];
    if n > 0 && points > 0 {
        for (p, e) in energy.iter_mut().enumerate() {
            let a = p * n / points;
            let b = ((p + 1) * n / points).max(a + 1).min(n);
            let rms = r.frames[a..b].iter().map(|f| f[RMS]).sum::<f32>() / (b - a) as f32;
            *e = rms;
        }
        let max = energy.iter().fold(0.0f32, |m, &v| m.max(v));
        if max > 0.0 {
            energy.iter_mut().for_each(|v| *v = (*v / max).sqrt());
        }
    }
    FileSummary {
        bpm,
        beats,
        key: if n > 0 { key } else { -1 },
        key_confidence,
        energy,
    }
}
