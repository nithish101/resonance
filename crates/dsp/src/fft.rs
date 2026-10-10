//! Hand-written FFTs (DSP-2).
//!
//! [`Fft`] is an iterative, in-place, radix-2 decimation-in-time complex FFT: a bit-reversal
//! permutation followed by log2(n) butterfly stages. Twiddle factors and the bit-reversal table
//! are computed once in `new`, so `forward`/`inverse` never allocate.
//!
//! [`RealFft`] computes the spectrum of a real signal of length n with one complex FFT of length
//! n/2: pack even/odd samples as real/imaginary parts, transform, then untangle the two
//! interleaved spectra with one extra pass. That roughly halves the work of the naive approach
//! (zero imaginary parts, full-size FFT).
//!
//! Both are verified against `rustfft` in tests/fft.rs and benchmarked in benches/fft.rs.

use crate::complex::Complex;

#[derive(Debug, Clone)]
pub struct Fft {
    n: usize,
    /// Twiddles laid out stage by stage so each butterfly loop reads them contiguously: the
    /// stage with half-span h stores e^{-2πik/(2h)} for k < h, starting at offset h - 2
    /// (the span-2 stage needs none). `inv` holds the conjugates for the inverse transform.
    fwd: Vec<Complex>,
    inv: Vec<Complex>,
    bitrev: Vec<u32>,
}

impl Fft {
    /// # Panics
    /// If `n` is not a power of two or is less than 2.
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 2 && n.is_power_of_two(),
            "FFT size must be a power of two >= 2"
        );
        let bits = n.trailing_zeros();
        let mut fwd = Vec::with_capacity(n);
        let mut half = 2;
        while half < n {
            for k in 0..half {
                let theta = -core::f64::consts::PI * k as f64 / half as f64;
                fwd.push(Complex::cis(theta));
            }
            half *= 2;
        }
        let inv = fwd.iter().map(|w| w.conj()).collect();
        let bitrev = (0..n as u32)
            .map(|i| i.reverse_bits() >> (32 - bits))
            .collect();
        Self {
            n,
            fwd,
            inv,
            bitrev,
        }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        false
    }

    /// In-place forward transform: X[k] = Σ x[j]·e^{-2πijk/n}. Unnormalized.
    pub fn forward(&self, buf: &mut [Complex]) {
        self.transform(buf, false);
    }

    /// In-place inverse transform, normalized by 1/n so `inverse(forward(x)) == x`.
    pub fn inverse(&self, buf: &mut [Complex]) {
        self.transform(buf, true);
        let k = 1.0 / self.n as f32;
        for v in buf.iter_mut() {
            *v = v.scale(k);
        }
    }

    fn transform(&self, buf: &mut [Complex], inverse: bool) {
        let n = self.n;
        assert_eq!(buf.len(), n, "buffer length must equal FFT size");

        for (i, &j) in self.bitrev.iter().enumerate() {
            let j = j as usize;
            if i < j {
                buf.swap(i, j);
            }
        }

        // Stage with butterflies of span 2: twiddle is always 1.
        for pair in buf.chunks_exact_mut(2) {
            let (a, b) = (pair[0], pair[1]);
            pair[0] = a + b;
            pair[1] = a - b;
        }

        let table = if inverse { &self.inv } else { &self.fwd };
        let mut half = 2;
        while half < n {
            let size = half * 2;
            let tw = &table[half - 2..2 * half - 2];
            for block in buf.chunks_exact_mut(size) {
                let (lo, hi) = block.split_at_mut(half);
                for ((a, b), &w) in lo.iter_mut().zip(hi.iter_mut()).zip(tw) {
                    let t = *b * w;
                    *b = *a - t;
                    *a = *a + t;
                }
            }
            half = size;
        }
    }
}

/// FFT of a real signal of length n via one complex FFT of length n/2.
#[derive(Debug, Clone)]
pub struct RealFft {
    n: usize,
    half: Fft,
    /// e^{-2πik/n} for k <= n/2, for the untangling pass.
    twiddles: Vec<Complex>,
}

impl RealFft {
    /// # Panics
    /// If `n` is not a power of two or is less than 4.
    pub fn new(n: usize) -> Self {
        assert!(
            n >= 4 && n.is_power_of_two(),
            "real FFT size must be a power of two >= 4"
        );
        let twiddles = (0..=n / 2)
            .map(|k| Complex::cis(-2.0 * core::f64::consts::PI * k as f64 / n as f64))
            .collect();
        Self {
            n,
            half: Fft::new(n / 2),
            twiddles,
        }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        false
    }

    /// Computes bins 0..=n/2 of the spectrum of `input` (length n) into `out` (length n/2 + 1).
    /// `scratch` must have length n/2. Does not allocate.
    pub fn forward(&self, input: &[f32], out: &mut [Complex], scratch: &mut [Complex]) {
        let n = self.n;
        let m = n / 2;
        assert_eq!(input.len(), n);
        assert_eq!(out.len(), m + 1);
        assert_eq!(scratch.len(), m);

        // z[j] = x[2j] + i·x[2j+1]
        for (z, pair) in scratch.iter_mut().zip(input.chunks_exact(2)) {
            *z = Complex::new(pair[0], pair[1]);
        }
        self.half.forward(scratch);

        // With Z = FFT(z): E[k] = (Z[k] + conj(Z[m-k]))/2 is the even-sample spectrum,
        // O[k] = (Z[k] - conj(Z[m-k]))/(2i) the odd-sample spectrum, and
        // X[k] = E[k] + W^k·O[k] with W = e^{-2πi/n}.
        let z0 = scratch[0];
        out[0] = Complex::new(z0.re + z0.im, 0.0);
        out[m] = Complex::new(z0.re - z0.im, 0.0);
        for k in 1..m {
            let a = scratch[k];
            let b = scratch[m - k].conj();
            let even = (a + b).scale(0.5);
            let d = (a - b).scale(0.5);
            let odd = Complex::new(d.im, -d.re); // d / i
            out[k] = even + self.twiddles[k] * odd;
        }
    }
}
