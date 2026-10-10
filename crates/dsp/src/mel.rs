//! Slaney-style mel filterbank (DSP-3): the Auditory Toolbox mel scale (linear below 1 kHz,
//! logarithmic above) with area-normalized triangles. Matches librosa's defaults
//! (`htk=False, norm="slaney"`), which tests/mel.rs checks against reference values.

/// Hz -> mel on the Slaney scale.
pub fn hz_to_mel(hz: f64) -> f64 {
    const F_SP: f64 = 200.0 / 3.0;
    const MIN_LOG_HZ: f64 = 1000.0;
    const MIN_LOG_MEL: f64 = MIN_LOG_HZ / F_SP;
    let logstep = 6.4f64.ln() / 27.0;
    if hz >= MIN_LOG_HZ {
        MIN_LOG_MEL + (hz / MIN_LOG_HZ).ln() / logstep
    } else {
        hz / F_SP
    }
}

/// Mel -> Hz on the Slaney scale.
pub fn mel_to_hz(mel: f64) -> f64 {
    const F_SP: f64 = 200.0 / 3.0;
    const MIN_LOG_HZ: f64 = 1000.0;
    const MIN_LOG_MEL: f64 = MIN_LOG_HZ / F_SP;
    let logstep = 6.4f64.ln() / 27.0;
    if mel >= MIN_LOG_MEL {
        MIN_LOG_HZ * (logstep * (mel - MIN_LOG_MEL)).exp()
    } else {
        F_SP * mel
    }
}

/// One triangular filter stored sparsely: weights for bins `start..start + weights.len()`.
#[derive(Debug, Clone)]
pub struct Filter {
    pub start: usize,
    pub weights: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct MelBank {
    pub filters: Vec<Filter>,
    /// Centre frequency of each filter in Hz.
    pub centers: Vec<f32>,
}

impl MelBank {
    /// `n_fft` is the FFT length; the bank applies to its `n_fft/2 + 1` power bins.
    pub fn new(sample_rate: f32, n_fft: usize, n_mels: usize, fmin: f32, fmax: f32) -> Self {
        let n_bins = n_fft / 2 + 1;
        let bin_hz: Vec<f64> = (0..n_bins)
            .map(|k| k as f64 * sample_rate as f64 / n_fft as f64)
            .collect();
        let (mmin, mmax) = (hz_to_mel(fmin as f64), hz_to_mel(fmax as f64));
        let pts: Vec<f64> = (0..n_mels + 2)
            .map(|i| mel_to_hz(mmin + (mmax - mmin) * i as f64 / (n_mels + 1) as f64))
            .collect();

        let mut filters = Vec::with_capacity(n_mels);
        let mut centers = Vec::with_capacity(n_mels);
        for m in 0..n_mels {
            let (lo, mid, hi) = (pts[m], pts[m + 1], pts[m + 2]);
            let norm = 2.0 / (hi - lo); // Slaney: unit area in Hz
            let mut start = usize::MAX;
            let mut weights = Vec::new();
            for (k, &f) in bin_hz.iter().enumerate() {
                let up = (f - lo) / (mid - lo);
                let down = (hi - f) / (hi - mid);
                let w = up.min(down).max(0.0) * norm;
                if w > 0.0 {
                    if start == usize::MAX {
                        start = k;
                    }
                    // Keep weights contiguous from `start` (triangles have no interior gaps).
                    weights.resize(k - start, 0.0);
                    weights.push(w as f32);
                }
            }
            if start == usize::MAX {
                // Narrower than one bin (tiny FFTs at low frequencies): an empty filter.
                start = 0;
            }
            filters.push(Filter { start, weights });
            centers.push(mid as f32);
        }
        Self { filters, centers }
    }

    pub fn len(&self) -> usize {
        self.filters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.filters.is_empty()
    }

    /// Applies the bank to a power spectrum. `out.len()` must equal the number of filters.
    pub fn apply(&self, power: &[f32], out: &mut [f32]) {
        for (o, f) in out.iter_mut().zip(&self.filters) {
            *o = power[f.start..f.start + f.weights.len()]
                .iter()
                .zip(&f.weights)
                .map(|(p, w)| p * w)
                .sum();
        }
    }
}
