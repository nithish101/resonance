//! FFT correctness (PRD 9.1): known sine bin, agreement with rustfft, Parseval, linearity, and
//! inverse round-trip.

use proptest::prelude::*;
use resonance_dsp::fft::{Fft, RealFft};
use resonance_dsp::Complex;
use rustfft::{num_complex::Complex32, FftPlanner};

fn rustfft_forward(x: &[Complex]) -> Vec<Complex> {
    let mut buf: Vec<Complex32> = x.iter().map(|c| Complex32::new(c.re, c.im)).collect();
    FftPlanner::new()
        .plan_fft_forward(x.len())
        .process(&mut buf);
    buf.into_iter().map(|c| Complex::new(c.re, c.im)).collect()
}

fn noise(n: usize, seed: u64) -> Vec<f32> {
    let mut rng = resonance_fixtures::Rng::new(seed);
    (0..n).map(|_| rng.bipolar()).collect()
}

/// max |a - b| / max |b|: error relative to the spectrum's scale.
fn rel_err(a: &[Complex], b: &[Complex]) -> f32 {
    let scale = b.iter().map(|c| c.norm()).fold(0.0f32, f32::max).max(1e-12);
    a.iter()
        .zip(b)
        .map(|(x, y)| (*x - *y).norm())
        .fold(0.0f32, f32::max)
        / scale
}

#[test]
fn sine_lands_in_expected_bin() {
    let n = 2048;
    let fft = Fft::new(n);
    for k in [1usize, 10, 100, 511, 1023] {
        let mut buf: Vec<Complex> = (0..n)
            .map(|i| {
                let t = 2.0 * std::f64::consts::PI * k as f64 * i as f64 / n as f64;
                Complex::new(t.sin() as f32, 0.0)
            })
            .collect();
        fft.forward(&mut buf);
        let peak = (0..=n / 2)
            .max_by(|&a, &b| buf[a].norm().total_cmp(&buf[b].norm()))
            .unwrap();
        assert_eq!(peak, k);
        // A unit sine puts n/2 in its bin.
        assert!((buf[k].norm() - n as f32 / 2.0).abs() < 0.01 * n as f32);
    }
}

#[test]
fn matches_rustfft_for_all_sizes() {
    for log in 1..=14 {
        let n = 1usize << log;
        let x: Vec<Complex> = noise(2 * n, log as u64)
            .chunks_exact(2)
            .map(|p| Complex::new(p[0], p[1]))
            .collect();
        let mut ours = x.clone();
        Fft::new(n).forward(&mut ours);
        let reference = rustfft_forward(&x);
        let e = rel_err(&ours, &reference);
        assert!(e < 1e-4, "n={n}: relative error {e}");
    }
}

#[test]
fn real_fft_matches_rustfft() {
    for log in 2..=14 {
        let n = 1usize << log;
        let x = noise(n, 100 + log as u64);
        let rf = RealFft::new(n);
        let mut out = vec![Complex::ZERO; n / 2 + 1];
        let mut scratch = vec![Complex::ZERO; n / 2];
        rf.forward(&x, &mut out, &mut scratch);
        let full = rustfft_forward(&x.iter().map(|&v| Complex::new(v, 0.0)).collect::<Vec<_>>());
        let e = rel_err(&out, &full[..=n / 2]);
        assert!(e < 1e-4, "n={n}: relative error {e}");
    }
}

#[test]
fn parseval_holds() {
    let n = 4096;
    let x = noise(n, 7);
    let mut buf: Vec<Complex> = x.iter().map(|&v| Complex::new(v, 0.0)).collect();
    Fft::new(n).forward(&mut buf);
    let time: f64 = x.iter().map(|v| (*v as f64).powi(2)).sum();
    let freq: f64 = buf.iter().map(|c| c.norm_sqr() as f64).sum::<f64>() / n as f64;
    assert!(
        (time - freq).abs() / time < 1e-5,
        "time {time} vs freq {freq}"
    );
}

#[test]
fn transform_is_linear() {
    let n = 1024;
    let fft = Fft::new(n);
    let a: Vec<Complex> = noise(n, 1).iter().map(|&v| Complex::new(v, 0.0)).collect();
    let b: Vec<Complex> = noise(n, 2).iter().map(|&v| Complex::new(0.0, v)).collect();
    let (alpha, beta) = (0.7f32, -1.3f32);
    let mut combo: Vec<Complex> = a
        .iter()
        .zip(&b)
        .map(|(x, y)| x.scale(alpha) + y.scale(beta))
        .collect();
    let (mut fa, mut fb) = (a.clone(), b.clone());
    fft.forward(&mut fa);
    fft.forward(&mut fb);
    fft.forward(&mut combo);
    let expected: Vec<Complex> = fa
        .iter()
        .zip(&fb)
        .map(|(x, y)| x.scale(alpha) + y.scale(beta))
        .collect();
    assert!(rel_err(&combo, &expected) < 1e-5);
}

proptest! {
    #[test]
    fn inverse_round_trips(log in 1u32..=12, seed in any::<u64>()) {
        let n = 1usize << log;
        let x: Vec<Complex> = noise(2 * n, seed)
            .chunks_exact(2)
            .map(|p| Complex::new(p[0], p[1]))
            .collect();
        let fft = Fft::new(n);
        let mut buf = x.clone();
        fft.forward(&mut buf);
        fft.inverse(&mut buf);
        for (got, want) in buf.iter().zip(&x) {
            prop_assert!((*got - *want).norm() < 1e-5 * (n as f32).log2().max(1.0));
        }
    }
}
