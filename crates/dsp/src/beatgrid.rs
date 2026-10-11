//! Offline beat grid (DSP-9) by dynamic programming (Ellis 2007, "Beat Tracking by Dynamic
//! Programming", the algorithm behind librosa's `beat_track`).
//!
//! Given the whole onset-strength envelope O and a tempo period P (frames), find beat times
//! b_1..b_n maximizing Σ O(b_i) − α·Σ log²((b_{i+1} − b_i) / P): beats should sit on strong onsets
//! and be spaced close to one period. One forward pass fills
//!
//! ```text
//! C(t) = O(t) + max over τ in [t − 2P, t − P/2] of ( C(τ) − α·log²((t − τ)/P) )
//! ```
//!
//! remembering the best predecessor, then a backtrack from the best-scoring final beat recovers
//! the grid. Non-causal, so it can only run on a whole file; the live path uses
//! [`crate::beat::BeatTracker`].

/// Tightness: how strongly beat spacing is held to the period (librosa's default).
pub const TIGHTNESS: f64 = 100.0;

/// Beat positions in frames for onset envelope `env` at period `period` frames.
pub fn beat_grid(env: &[f32], period: f64) -> Vec<f64> {
    let n = env.len();
    if n == 0 || period < 2.0 {
        return Vec::new();
    }
    // Normalize the envelope by its standard deviation, as Ellis does.
    let mean = env.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
    let sd = (env.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / n as f64).sqrt();
    let o: Vec<f64> = env.iter().map(|&v| v as f64 / sd.max(1e-9)).collect();

    let mut score = vec![0.0f64; n];
    let mut back = vec![usize::MAX; n];
    let lo = (period / 2.0).round() as usize;
    let hi = (2.0 * period).round() as usize;
    for t in 0..n {
        let mut best = 0.0;
        let mut arg = usize::MAX;
        if t > lo {
            let start = t.saturating_sub(hi);
            for (tau, &prev) in score.iter().enumerate().take(t - lo + 1).skip(start) {
                let ratio = (t - tau) as f64 / period;
                let s = prev - TIGHTNESS * ratio.ln().powi(2);
                if arg == usize::MAX || s > best {
                    best = s;
                    arg = tau;
                }
            }
        }
        score[t] = o[t] + if arg == usize::MAX { 0.0 } else { best };
        back[t] = arg;
    }

    // Start from the best-scoring frame in the last period, then follow predecessors.
    let tail = n.saturating_sub(period.round() as usize).min(n - 1);
    let mut t = (tail..n)
        .max_by(|&a, &b| score[a].total_cmp(&score[b]))
        .unwrap_or(n - 1);
    let mut beats = vec![t as f64];
    while back[t] != usize::MAX {
        t = back[t];
        beats.push(t as f64);
    }
    beats.reverse();
    // Trim weak beats at the edges (before the music starts or after it ends), as librosa does.
    let strength: Vec<f64> = beats.iter().map(|&b| o[b as usize]).collect();
    let thresh = 0.5 * (strength.iter().map(|s| s * s).sum::<f64>() / strength.len() as f64).sqrt();
    let first = strength.iter().position(|&s| s >= thresh).unwrap_or(0);
    let last = strength
        .iter()
        .rposition(|&s| s >= thresh)
        .unwrap_or(beats.len() - 1);
    beats[first..=last].to_vec()
}
