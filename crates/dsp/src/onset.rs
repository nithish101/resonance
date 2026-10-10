//! Onset detection (DSP-5): half-wave-rectified spectral flux on the log-mel spectrum, an
//! adaptive threshold (moving median + offset), and causal peak picking with a minimum gap.
//!
//! Peak picking needs one frame of lookahead (a peak is only known once the next value is
//! lower), so `update` at frame t reports whether frame t-1 was an onset.

/// Number of past flux values in the moving median (~0.37 s at 86 hops/s).
pub const MEDIAN_LEN: usize = 32;

#[derive(Debug, Clone)]
pub struct OnsetDetector {
    prev: Vec<f32>,
    has_prev: bool,
    history: [f32; MEDIAN_LEN],
    hist_len: usize,
    hist_pos: usize,
    scratch: [f32; MEDIAN_LEN],
    /// Flux at t-2 and t-1.
    f2: f32,
    f1: f32,
    /// Threshold computed for t-1.
    thr1: f32,
    /// Offset above the median, in dB of mean per-band rise.
    pub delta: f32,
    min_gap: usize,
    since_last: usize,
}

impl OnsetDetector {
    pub fn new(n_bands: usize, hop_rate_hz: f32, min_gap_secs: f32) -> Self {
        Self {
            prev: vec![0.0; n_bands],
            has_prev: false,
            history: [0.0; MEDIAN_LEN],
            hist_len: 0,
            hist_pos: 0,
            scratch: [0.0; MEDIAN_LEN],
            f2: 0.0,
            f1: 0.0,
            thr1: f32::INFINITY,
            delta: 1.0,
            min_gap: (min_gap_secs * hop_rate_hz).round().max(1.0) as usize,
            since_last: usize::MAX / 2,
        }
    }

    pub fn reset(&mut self) {
        self.has_prev = false;
        self.hist_len = 0;
        self.hist_pos = 0;
        self.f2 = 0.0;
        self.f1 = 0.0;
        self.thr1 = f32::INFINITY;
        self.since_last = usize::MAX / 2;
    }

    fn median(&mut self) -> f32 {
        let n = self.hist_len;
        if n == 0 {
            return 0.0;
        }
        let s = &mut self.scratch[..n];
        s.copy_from_slice(&self.history[..n]);
        s.sort_unstable_by(f32::total_cmp);
        if n % 2 == 1 {
            s[n / 2]
        } else {
            0.5 * (s[n / 2 - 1] + s[n / 2])
        }
    }

    /// Feeds frame t's log-mel spectrum (dB). Returns (flux at t, whether t-1 is an onset).
    /// `allow` is false while the noise gate is closed (ER-4): flux is tracked, onsets aren't.
    pub fn update(&mut self, log_mel_db: &[f32], allow: bool) -> (f32, bool) {
        let mut flux = 0.0;
        if self.has_prev {
            for (cur, prev) in log_mel_db.iter().zip(&self.prev) {
                flux += (cur - prev).max(0.0);
            }
            flux /= log_mel_db.len() as f32;
        }
        self.prev.copy_from_slice(log_mel_db);
        self.has_prev = true;

        // Peak pick t-1 against its own threshold, now that flux(t) is known.
        self.since_last = self.since_last.saturating_add(1);
        let is_onset = allow
            && self.f1 > self.thr1
            && self.f1 >= self.f2
            && self.f1 > flux
            && self.since_last > self.min_gap;
        if is_onset {
            self.since_last = 0;
        }

        // Threshold for t uses the median of values before t.
        let thr = self.median() + self.delta;
        self.history[self.hist_pos] = flux;
        self.hist_pos = (self.hist_pos + 1) % MEDIAN_LEN;
        self.hist_len = (self.hist_len + 1).min(MEDIAN_LEN);

        self.f2 = self.f1;
        self.f1 = flux;
        self.thr1 = thr;
        (flux, is_onset)
    }
}
