//! The per-hop analysis pipeline (DSP-1..5, DSP-10, DSP-11).
//!
//! Each call to [`Analyzer::process`] consumes `hop` new mono samples from [`Analyzer::input_mut`]
//! and writes one feature frame to [`Analyzer::frame`]. Every buffer is allocated in
//! [`Analyzer::new`]; `process` performs no heap allocation (checked by tests/no_alloc.rs).

use crate::complex::Complex;
use crate::envelope::{power_db, Follower, PeakTracker};
use crate::fft::RealFft;
use crate::frame::*;
use crate::mel::MelBank;
use crate::onset::OnsetDetector;
use crate::tempo::TempoEstimator;
use crate::window::hann;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Config {
    pub sample_rate: f32,
    /// STFT frame length; must be a power of two.
    pub frame_size: usize,
    pub hop: usize,
    pub fmin: f32,
    pub fmax: f32,
}

impl Config {
    /// Defaults from PRD DSP-1: 2048-sample frames, 512-sample hop. Frequencies derive from the
    /// actual sample rate (IN-7).
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            frame_size: 2048,
            hop: 512,
            fmin: 30.0,
            fmax: (sample_rate / 2.0).min(16_000.0),
        }
    }

    pub fn hop_rate(&self) -> f32 {
        self.sample_rate / self.hop as f32
    }
}

/// Level (dBFS) below which the noise gate closes (ER-4). Opens again 5 dB higher.
const GATE_CLOSE_DB: f32 = -62.0;
const GATE_OPEN_DB: f32 = -57.0;
/// Auto-gain never treats a level below this as full scale, so a quiet room can't be amplified
/// into bright visuals.
const AUTOGAIN_FLOOR_DB: f32 = -48.0;
/// Auto-gain references decay this fast (dB/s): slow enough that a quiet passage in a loud
/// track still reads as quiet, fast enough to adapt to a new track within a few seconds.
const AUTOGAIN_DECAY_DB_PER_SEC: f32 = 3.0;
/// Spectral-flux floor below the loudest mel bin's reference (dB).
const ONSET_FLOOR_DB: f32 = 40.0;
/// A band or mel bin is never boosted more than this far above the overall level.
const MAX_RELATIVE_BOOST_DB: f32 = 30.0;

pub struct Analyzer {
    cfg: Config,
    window: Vec<f32>,
    window_gain: f32,
    /// The last `frame_size` samples, oldest first.
    history: Vec<f32>,
    input: Vec<f32>,
    windowed: Vec<f32>,
    spectrum: Vec<Complex>,
    scratch: Vec<Complex>,
    power: Vec<f32>,
    fft: RealFft,
    mel: MelBank,
    mel_power: Vec<f32>,
    mel_db: Vec<f32>,
    onset_db: Vec<f32>,
    mel_peak: Vec<PeakTracker>,
    mel_env: Vec<Follower>,
    band_bins: [(usize, usize); BANDS],
    band_peak: [PeakTracker; BANDS],
    band_env: [Follower; BANDS],
    level_peak: PeakTracker,
    loudness_env: Follower,
    gate_env: Follower,
    gate_open: bool,
    onsets: OnsetDetector,
    tempo: TempoEstimator,
    bin_hz: Vec<f32>,
    sensitivity: f32,
    smoothing: f32,
    frame: [f32; FRAME_FLOATS],
    hops: u64,
}

impl Analyzer {
    pub fn new(cfg: Config) -> Self {
        let n = cfg.frame_size;
        assert!(cfg.hop > 0 && cfg.hop <= n, "hop must be in 1..=frame_size");
        let rate = cfg.hop_rate();
        let window = hann(n);
        let window_gain = window.iter().sum::<f32>() / 2.0;
        let n_bins = n / 2 + 1;
        let bin_hz: Vec<f32> = (0..n_bins)
            .map(|k| k as f32 * cfg.sample_rate / n as f32)
            .collect();
        let bin_of = |hz: f32| ((hz * n as f32 / cfg.sample_rate).round() as usize).min(n_bins - 1);
        let mut band_bins = [(0, 0); BANDS];
        for (b, slot) in band_bins.iter_mut().enumerate() {
            let lo = bin_of(BAND_EDGES_HZ[b]).max(1);
            let hi = bin_of(BAND_EDGES_HZ[b + 1].min(cfg.sample_rate / 2.0)).max(lo + 1);
            *slot = (lo, hi.min(n_bins));
        }
        let peak = PeakTracker::new(AUTOGAIN_FLOOR_DB, AUTOGAIN_DECAY_DB_PER_SEC, rate);
        let mut a = Self {
            cfg,
            window,
            window_gain,
            history: vec![0.0; n],
            input: vec![0.0; cfg.hop],
            windowed: vec![0.0; n],
            spectrum: vec![Complex::ZERO; n_bins],
            scratch: vec![Complex::ZERO; n / 2],
            power: vec![0.0; n_bins],
            fft: RealFft::new(n),
            mel: MelBank::new(cfg.sample_rate, n, MEL_BANDS, cfg.fmin, cfg.fmax),
            mel_power: vec![0.0; MEL_BANDS],
            mel_db: vec![0.0; MEL_BANDS],
            onset_db: vec![0.0; MEL_BANDS],
            mel_peak: vec![peak; MEL_BANDS],
            mel_env: vec![Follower::new(0.0, 0.1, rate); MEL_BANDS],
            band_bins,
            band_peak: [peak; BANDS],
            band_env: [Follower::new(0.0, 0.2, rate); BANDS],
            level_peak: peak,
            loudness_env: Follower::new(0.01, 0.3, rate),
            gate_env: Follower::new(0.03, 0.25, rate),
            gate_open: false,
            onsets: OnsetDetector::new(MEL_BANDS, rate, 0.06),
            tempo: TempoEstimator::new(rate),
            bin_hz,
            sensitivity: 1.0,
            smoothing: 0.5,
            frame: [0.0; FRAME_FLOATS],
            hops: 0,
        };
        a.set_params(1.0, 0.5);
        a
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Write the next `hop` samples here, then call [`Self::process`].
    pub fn input_mut(&mut self) -> &mut [f32] {
        &mut self.input
    }

    pub fn frame(&self) -> &[f32; FRAME_FLOATS] {
        &self.frame
    }

    pub fn hops(&self) -> u64 {
        self.hops
    }

    /// `sensitivity` in [0.25, 4] (1 = default): narrows the auto-gain range and lowers the
    /// onset threshold. `smoothing` in [0, 1]: lengthens envelope release times.
    pub fn set_params(&mut self, sensitivity: f32, smoothing: f32) {
        self.sensitivity = sensitivity.clamp(0.25, 4.0);
        self.smoothing = smoothing.clamp(0.0, 1.0);
        let rate = self.cfg.hop_rate();
        let band_release = 0.04 + 0.5 * self.smoothing;
        let mel_release = 0.02 + 0.3 * self.smoothing;
        for f in &mut self.band_env {
            f.set_times(0.0, band_release, rate);
        }
        for f in &mut self.mel_env {
            f.set_times(0.0, mel_release, rate);
        }
        self.onsets.delta = 1.2 / self.sensitivity;
    }

    pub fn reset(&mut self) {
        self.history.fill(0.0);
        self.frame = [0.0; FRAME_FLOATS];
        for p in self.mel_peak.iter_mut().chain(self.band_peak.iter_mut()) {
            p.reset();
        }
        self.level_peak.reset();
        for f in self.mel_env.iter_mut().chain(self.band_env.iter_mut()) {
            f.value = 0.0;
        }
        self.loudness_env.value = 0.0;
        self.gate_env.value = 0.0;
        self.gate_open = false;
        self.onsets.reset();
        self.tempo.reset();
    }

    fn range_db(&self) -> f32 {
        36.0 / self.sensitivity
    }

    /// Analyses one hop. No heap allocation.
    pub fn process(&mut self) {
        let n = self.cfg.frame_size;
        let hop = self.cfg.hop;

        // STFT frame: slide history left by one hop and append the new samples (DSP-1).
        self.history.copy_within(hop.., 0);
        self.history[n - hop..].copy_from_slice(&self.input);

        let mut sum_sq = 0.0f32;
        for ((w, x), win) in self
            .windowed
            .iter_mut()
            .zip(&self.history)
            .zip(&self.window)
        {
            sum_sq += x * x;
            *w = x * win;
        }
        let rms = (sum_sq / n as f32).sqrt();
        let level_db = 20.0 * rms.max(1e-9).log10();

        self.fft
            .forward(&self.windowed, &mut self.spectrum, &mut self.scratch);

        // Power normalized so a full-scale sine reads 0 dB in its peak bin.
        let norm = 1.0 / (self.window_gain * self.window_gain);
        let mut mag_sum = 0.0f32;
        let mut weighted = 0.0f32;
        for ((p, c), hz) in self.power.iter_mut().zip(&self.spectrum).zip(&self.bin_hz) {
            *p = c.norm_sqr() * norm;
            let m = p.sqrt();
            mag_sum += m;
            weighted += m * hz;
        }

        // Noise gate with hysteresis (ER-4).
        if self.gate_open && level_db < GATE_CLOSE_DB {
            self.gate_open = false;
        } else if !self.gate_open && level_db > GATE_OPEN_DB {
            self.gate_open = true;
        }
        let gate = self.gate_env.update(if self.gate_open { 1.0 } else { 0.0 });

        // Auto-gain reference follows the overall level, never below the floor.
        let level_ref = if self.gate_open {
            self.level_peak.update(level_db)
        } else {
            self.level_peak.db
        };
        let range = self.range_db();

        // Mel spectrum (DSP-3), with per-bin slow peak references for auto-gain.
        self.mel.apply(&self.power, &mut self.mel_power);
        let mut mel_max_ref = f32::MIN;
        for b in 0..MEL_BANDS {
            let db = power_db(self.mel_power[b]);
            self.mel_db[b] = db;
            if self.gate_open {
                self.mel_peak[b].update(db);
            }
            mel_max_ref = mel_max_ref.max(self.mel_peak[b].db);
        }

        // Onsets on the raw log-mel spectrum, independent of auto-gain (DSP-5). Each bin is
        // floored ONSET_FLOOR_DB below its own slow peak, so faint fluctuations (partials
        // beating, reverb tails) don't register as rises. Per-bin, because Slaney area
        // normalization puts wide high-frequency bins on a lower dB scale than narrow low ones.
        for b in 0..MEL_BANDS {
            self.onset_db[b] = self.mel_db[b].max(self.mel_peak[b].db - ONSET_FLOOR_DB);
        }
        let (flux, onset) = self.onsets.update(&self.onset_db, self.gate_open);
        // Tempo from the onset-strength envelope (DSP-6); silence contributes nothing.
        self.tempo.push(if self.gate_open { flux } else { 0.0 });

        // Normalized mel for display: per-bin reference, capped relative to the strongest bin.
        for b in 0..MEL_BANDS {
            let reference = self.mel_peak[b].db.max(mel_max_ref - MAX_RELATIVE_BOOST_DB);
            let v = ((self.mel_db[b] - (reference - range)) / range).clamp(0.0, 1.0);
            self.frame[MEL_AT + b] = self.mel_env[b].update(v) * gate;
        }

        // Six bands with envelopes and auto-gain (DSP-4).
        let mut band_db = [0.0f32; BANDS];
        let mut band_max_ref = f32::MIN;
        for (b, &(lo, hi)) in self.band_bins.iter().enumerate() {
            let e: f32 = self.power[lo..hi].iter().sum();
            band_db[b] = power_db(e);
            if self.gate_open {
                self.band_peak[b].update(band_db[b]);
            }
            band_max_ref = band_max_ref.max(self.band_peak[b].db);
        }
        let outs = &mut self.frame[BANDS_AT..BANDS_AT + BANDS];
        for (((out, db), peak), env) in outs
            .iter_mut()
            .zip(&band_db)
            .zip(&self.band_peak)
            .zip(&mut self.band_env)
        {
            let reference = peak.db.max(band_max_ref - MAX_RELATIVE_BOOST_DB);
            let v = ((db - (reference - range)) / range).clamp(0.0, 1.0);
            *out = env.update(v) * gate;
        }

        // Centroid and loudness (DSP-10).
        let centroid = if mag_sum > 1e-9 {
            weighted / mag_sum
        } else {
            0.0
        };
        let centroid_norm = if centroid > 0.0 {
            ((centroid / 50.0).log2() / (16_000.0f32 / 50.0).log2()).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let loudness = ((level_db - (level_ref - range)) / range).clamp(0.0, 1.0);

        let f = &mut self.frame;
        f[FLUX] = (flux / 6.0).clamp(0.0, 4.0);
        f[ONSET] = if onset { 1.0 } else { 0.0 };
        f[CENTROID] = centroid;
        f[CENTROID_NORM] = centroid_norm * gate;
        f[RMS] = rms;
        f[LOUDNESS] = self.loudness_env.update(loudness) * gate;
        f[GATE] = if self.gate_open { 1.0 } else { 0.0 };
        f[BPM] = self.tempo.bpm;
        f[TEMPO_CONFIDENCE] = self.tempo.confidence;
        f[KEY] = -1.0;
        self.hops += 1;
    }
}
