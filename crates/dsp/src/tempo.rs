//! Tempo estimation (DSP-6): autocorrelation of the onset-strength envelope, scored over
//! 60-180 BPM with a log-Gaussian tempo prior to suppress octave errors.
//!
//! Every `UPDATE_EVERY` hops:
//! 1. Take the last `WINDOW` onset-strength values (spectral flux), remove the mean.
//! 2. Autocorrelate via the FFT (zero-padded to avoid circular wrap): the *biased* estimate,
//!    which decays with lag, so a period's first multiples count for more than its distant ones.
//! 3. Score each candidate tempo b (0.25 BPM grid) by summing the ACF at its period and the
//!    first few multiples, weighted 1/k, with linear interpolation between integer lags:
//!
//!    ```text
//!    S(b) = Σ_{k=1..4} acf(k·L_b) / k,   L_b = 60·hop_rate / b
//!    ```
//!
//!    A pulse train with period P scores fully at L = P and at L = 2P (its multiples are all
//!    multiples of P), but the ACF decay favours P; at L = P/2 only even k hit, so it scores
//!    about half.
//! 4. Multiply by the prior w(b) = exp(-½·(log2(b/120)/σ)²) with σ = 1 octave, take the best,
//!    and refine it with a parabola through its neighbours.
//!
//! The reported tempo has hysteresis: a candidate more than 4% away from the current estimate
//! must win `SWITCH_AFTER` updates in a row before it replaces it, so the display doesn't flicker
//! between competing periods.

use crate::complex::Complex;
use crate::fft::Fft;

/// Onset-envelope history length in hops (about 6 s at 86 hops/s).
pub const WINDOW: usize = 512;
const FFT_LEN: usize = 2 * WINDOW;
const UPDATE_EVERY: usize = 8;
const MIN_FILL: usize = 256;
const SWITCH_AFTER: u32 = 3;
pub const BPM_MIN: f32 = 60.0;
pub const BPM_MAX: f32 = 180.0;
const BPM_STEP: f32 = 0.25;
const PRIOR_CENTER: f32 = 120.0;
const PRIOR_OCTAVES: f32 = 1.0;
const HARMONICS: usize = 4;

pub struct TempoEstimator {
    hop_rate: f32,
    env: [f32; WINDOW],
    pos: usize,
    filled: usize,
    since_update: usize,
    fft: Fft,
    buf: Vec<Complex>,
    acf: Vec<f32>,
    grid: Vec<f32>,
    prior: Vec<f32>,
    scores: Vec<f32>,
    pub bpm: f32,
    pub confidence: f32,
    challenger: f32,
    challenger_wins: u32,
}

impl TempoEstimator {
    pub fn new(hop_rate: f32) -> Self {
        let n = ((BPM_MAX - BPM_MIN) / BPM_STEP).round() as usize + 1;
        let grid: Vec<f32> = (0..n).map(|i| BPM_MIN + i as f32 * BPM_STEP).collect();
        let prior = grid
            .iter()
            .map(|&b| {
                let z = (b / PRIOR_CENTER).log2() / PRIOR_OCTAVES;
                (-0.5 * z * z).exp()
            })
            .collect();
        Self {
            hop_rate,
            env: [0.0; WINDOW],
            pos: 0,
            filled: 0,
            since_update: 0,
            fft: Fft::new(FFT_LEN),
            buf: vec![Complex::ZERO; FFT_LEN],
            acf: vec![0.0; FFT_LEN],
            scores: vec![0.0; grid.len()],
            grid,
            prior,
            bpm: 0.0,
            confidence: 0.0,
            challenger: 0.0,
            challenger_wins: 0,
        }
    }

    pub fn reset(&mut self) {
        self.env = [0.0; WINDOW];
        self.pos = 0;
        self.filled = 0;
        self.since_update = 0;
        self.bpm = 0.0;
        self.confidence = 0.0;
        self.challenger_wins = 0;
    }

    /// Adds one onset-strength value. No allocation.
    pub fn push(&mut self, strength: f32) {
        self.env[self.pos] = strength;
        self.pos = (self.pos + 1) % WINDOW;
        self.filled = (self.filled + 1).min(WINDOW);
        self.since_update += 1;
        if self.since_update >= UPDATE_EVERY && self.filled >= MIN_FILL {
            self.since_update = 0;
            self.estimate();
        }
    }

    fn acf_at(&self, lag: f32) -> f32 {
        let i = lag.floor() as usize;
        if i + 1 >= self.filled {
            return 0.0;
        }
        let t = lag - i as f32;
        self.acf[i] * (1.0 - t) + self.acf[i + 1] * t
    }

    fn estimate(&mut self) {
        let n = self.filled;
        // Chronological order, oldest first; mean removed; zero padded.
        let start = if n < WINDOW { 0 } else { self.pos };
        let mean = (0..n).map(|i| self.env[(start + i) % WINDOW]).sum::<f32>() / n as f32;
        for (i, c) in self.buf.iter_mut().enumerate() {
            *c = if i < n {
                Complex::new(self.env[(start + i) % WINDOW] - mean, 0.0)
            } else {
                Complex::ZERO
            };
        }
        self.fft.forward(&mut self.buf);
        for c in self.buf.iter_mut() {
            *c = Complex::new(c.norm_sqr(), 0.0);
        }
        self.fft.inverse(&mut self.buf);
        let zero = self.buf[0].re;
        if zero <= 1e-9 {
            self.confidence = 0.0;
            return;
        }
        for (a, c) in self.acf.iter_mut().zip(&self.buf) {
            *a = c.re / zero;
        }

        let mut best = 0;
        let mut sum = 0.0;
        for i in 0..self.grid.len() {
            let lag = 60.0 * self.hop_rate / self.grid[i];
            let mut s = 0.0;
            for k in 1..=HARMONICS {
                s += self.acf_at(lag * k as f32).max(0.0) / k as f32;
            }
            let v = s * self.prior[i];
            self.scores[i] = v;
            sum += v;
            if v > self.scores[best] {
                best = i;
            }
        }
        let top = self.scores[best];
        if top <= 0.0 {
            self.confidence = 0.0;
            return;
        }

        // Parabolic refinement around the best grid point.
        let mut candidate = self.grid[best];
        if best > 0 && best + 1 < self.grid.len() {
            let (a, b, c) = (self.scores[best - 1], top, self.scores[best + 1]);
            let d = a - 2.0 * b + c;
            if d < 0.0 {
                candidate += BPM_STEP * (0.5 * (a - c) / d).clamp(-0.5, 0.5);
            }
        }
        let mean_score = sum / self.grid.len() as f32;
        self.confidence = ((top - mean_score) / top).clamp(0.0, 1.0);

        if self.bpm == 0.0 || (candidate - self.bpm).abs() <= 0.04 * self.bpm {
            // Same tempo (or first estimate): follow it smoothly.
            self.bpm = if self.bpm == 0.0 {
                candidate
            } else {
                0.7 * self.bpm + 0.3 * candidate
            };
            self.challenger_wins = 0;
        } else if self.challenger_wins > 0
            && (candidate - self.challenger).abs() <= 0.04 * candidate
        {
            self.challenger_wins += 1;
            self.challenger = candidate;
            if self.challenger_wins >= SWITCH_AFTER {
                self.bpm = candidate;
                self.challenger_wins = 0;
            }
        } else {
            self.challenger = candidate;
            self.challenger_wins = 1;
        }
    }
}
