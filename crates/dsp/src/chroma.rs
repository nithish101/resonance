//! Chroma and key (DSP-8).
//!
//! **Chroma**: each spectrum bin between 200 Hz and 5 kHz is assigned to its nearest pitch class
//! (bin frequency → MIDI note = 69 + 12·log2(f / 440), mod 12) and contributes its magnitude.
//! The 12 values are normalized to a maximum of 1 and smoothed (~200 ms). The 200 Hz floor
//! matters: with a 2048-point FFT, bins are wider than a semitone below about 400 Hz, so kick
//! drums and bass (which dominate low bins) would land on essentially arbitrary pitch classes.
//! Chord tones still register through their harmonics above the floor.
//!
//! **Key**: a slow average of chroma (~8 s) is correlated (Pearson) with the
//! Krumhansl-Schmuckler major and minor key profiles rotated to all 12 tonics; the best of the
//! 24 is the key. Confidence is how far the best correlation clears the runner-up.

/// Krumhansl & Kessler (1982) probe-tone profiles, tonic first.
pub const MAJOR_PROFILE: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
pub const MINOR_PROFILE: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

pub struct Chroma {
    /// Pitch class of each spectrum bin, or 255 if outside the analysed range.
    bin_class: Vec<u8>,
    raw: [f32; 12],
    pub smoothed: [f32; 12],
    long: [f32; 12],
    fast: f32,
    slow: f32,
    pub key: i32,
    pub confidence: f32,
    frames: u32,
}

/// Pearson correlation of `x` with `profile` rotated so its tonic sits at pitch class `tonic`.
fn correlate(x: &[f32; 12], profile: &[f32; 12], tonic: usize) -> f32 {
    let mx = x.iter().sum::<f32>() / 12.0;
    let mp = profile.iter().sum::<f32>() / 12.0;
    let (mut num, mut dx, mut dp) = (0.0, 0.0, 0.0);
    for pc in 0..12 {
        let a = x[pc] - mx;
        let b = profile[(pc + 12 - tonic) % 12] - mp;
        num += a * b;
        dx += a * a;
        dp += b * b;
    }
    if dx <= 1e-12 {
        0.0
    } else {
        num / (dx * dp).sqrt()
    }
}

/// Best key for a chroma vector: (key index 0-11 major / 12-23 minor, best r, second best r).
pub fn estimate_key(chroma: &[f32; 12]) -> (i32, f32, f32) {
    let mut best = (-1, f32::MIN);
    let mut second = f32::MIN;
    for tonic in 0..12 {
        for (mode, profile) in [(0, &MAJOR_PROFILE), (12, &MINOR_PROFILE)] {
            let r = correlate(chroma, profile, tonic);
            if r > best.1 {
                second = best.1;
                best = (mode + tonic as i32, r);
            } else if r > second {
                second = r;
            }
        }
    }
    (best.0, best.1, second)
}

impl Chroma {
    pub fn new(sample_rate: f32, n_fft: usize, hop_rate: f32) -> Self {
        let bin_class = (0..=n_fft / 2)
            .map(|k| {
                let f = k as f32 * sample_rate / n_fft as f32;
                if !(200.0..=5000.0).contains(&f) {
                    return 255;
                }
                let midi = 69.0 + 12.0 * (f / 440.0).log2();
                (midi.round() as i32).rem_euclid(12) as u8
            })
            .collect();
        Self {
            bin_class,
            raw: [0.0; 12],
            smoothed: [0.0; 12],
            long: [0.0; 12],
            fast: crate::envelope::coeff(0.2, hop_rate),
            slow: crate::envelope::coeff(8.0, hop_rate),
            key: -1,
            confidence: 0.0,
            frames: 0,
        }
    }

    pub fn reset(&mut self) {
        self.smoothed = [0.0; 12];
        self.long = [0.0; 12];
        self.key = -1;
        self.confidence = 0.0;
        self.frames = 0;
    }

    /// Updates from a power spectrum (`n_fft/2 + 1` bins). `active` is false while the noise
    /// gate is closed: the key holds and chroma decays. No allocation.
    pub fn update(&mut self, power: &[f32], active: bool) {
        self.raw = [0.0; 12];
        if active {
            for (p, &c) in power.iter().zip(&self.bin_class) {
                if c != 255 {
                    self.raw[c as usize] += p.sqrt();
                }
            }
            let max = self.raw.iter().fold(0.0f32, |m, &v| m.max(v));
            if max > 0.0 {
                self.raw.iter_mut().for_each(|v| *v /= max);
            }
        }
        for pc in 0..12 {
            self.smoothed[pc] = self.raw[pc] + self.fast * (self.smoothed[pc] - self.raw[pc]);
            if active {
                self.long[pc] = self.raw[pc] + self.slow * (self.long[pc] - self.raw[pc]);
            }
        }
        if active {
            self.frames = self.frames.saturating_add(1);
            // About one second of material before committing to a key.
            if self.frames > 90 {
                let (key, best, second) = estimate_key(&self.long);
                self.key = key;
                self.confidence = ((best - second) / best.abs().max(1e-6) * 4.0).clamp(0.0, 1.0);
            }
        }
    }
}
