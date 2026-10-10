//! Analysis windows.

/// Periodic Hann window of length n (the STFT convention, as in `scipy.signal.get_window` and
/// librosa): w[i] = 0.5 - 0.5·cos(2πi/n). Its samples sum to exactly n/2, and windows
/// overlapped at hop n/4 sum to a constant.
pub fn hann(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| (0.5 - 0.5 * (2.0 * core::f64::consts::PI * i as f64 / n as f64).cos()) as f32)
        .collect()
}
