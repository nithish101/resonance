//! Criterion benchmarks (PRD 8): the hand-written FFT against rustfft, the real-input FFT, and
//! one full analysis hop. `pnpm bench` summarizes these into docs/benchmarks.md.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use resonance_dsp::fft::{Fft, RealFft};
use resonance_dsp::{Analyzer, Complex, Config};
use rustfft::{num_complex::Complex32, FftPlanner};

fn signal(n: usize) -> Vec<f32> {
    let mut rng = resonance_fixtures::Rng::new(9);
    (0..n).map(|_| rng.bipolar()).collect()
}

fn fft(c: &mut Criterion) {
    let mut g = c.benchmark_group("complex_fft");
    for n in [512usize, 1024, 2048, 4096] {
        let x: Vec<Complex> = signal(n).iter().map(|&v| Complex::new(v, 0.0)).collect();
        let ours = Fft::new(n);
        g.bench_with_input(BenchmarkId::new("resonance", n), &n, |b, _| {
            let mut buf = x.clone();
            b.iter(|| {
                buf.copy_from_slice(&x);
                ours.forward(black_box(&mut buf));
            })
        });
        let plan = FftPlanner::<f32>::new().plan_fft_forward(n);
        let xr: Vec<Complex32> = x.iter().map(|c| Complex32::new(c.re, c.im)).collect();
        let mut scratch = vec![Complex32::default(); plan.get_inplace_scratch_len()];
        g.bench_with_input(BenchmarkId::new("rustfft", n), &n, |b, _| {
            let mut buf = xr.clone();
            b.iter(|| {
                buf.copy_from_slice(&xr);
                plan.process_with_scratch(black_box(&mut buf), &mut scratch);
            })
        });
    }
    g.finish();

    let mut g = c.benchmark_group("real_fft");
    for n in [1024usize, 2048, 4096] {
        let x = signal(n);
        let rf = RealFft::new(n);
        let mut out = vec![Complex::ZERO; n / 2 + 1];
        let mut scratch = vec![Complex::ZERO; n / 2];
        g.bench_with_input(BenchmarkId::new("resonance", n), &n, |b, _| {
            b.iter(|| rf.forward(black_box(&x), &mut out, &mut scratch))
        });
    }
    g.finish();
}

fn hop(c: &mut Criterion) {
    let audio = resonance_fixtures::groove(44_100, 120.0, 10.0, 1).mono();
    let mut a = Analyzer::new(Config::new(44_100.0));
    let hop = a.config().hop;
    let chunks: Vec<&[f32]> = audio.chunks_exact(hop).collect();
    let mut i = 0;
    c.bench_function("analyzer_hop_2048_512", |b| {
        b.iter(|| {
            a.input_mut().copy_from_slice(chunks[i % chunks.len()]);
            a.process();
            i += 1;
            black_box(a.frame()[0]);
        })
    });
}

criterion_group!(benches, fft, hop);
criterion_main!(benches);
