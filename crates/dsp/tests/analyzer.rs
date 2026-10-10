//! Behaviour of the full per-hop pipeline on synthetic signals with known answers.

use resonance_dsp::eval::f_measure;
use resonance_dsp::frame::*;
use resonance_dsp::offline::analyze;
use resonance_dsp::Config;
use resonance_fixtures as fx;

fn tail_mean(frames: &[[f32; FRAME_FLOATS]], idx: usize) -> f32 {
    let tail = &frames[frames.len() / 2..];
    tail.iter().map(|f| f[idx]).sum::<f32>() / tail.len() as f32
}

#[test]
fn sine_centroid_and_bands() {
    for sr in [44_100u32, 48_000] {
        let s = fx::sine(sr, 1000.0, 3.0);
        let r = analyze(&s.samples, Config::new(sr as f32));
        let centroid = tail_mean(&r.frames, CENTROID);
        assert!(
            (centroid - 1000.0).abs() < 60.0,
            "sr {sr}: centroid {centroid}"
        );
        // 1 kHz sits in the "mid" band (500 Hz to 2 kHz).
        let bands: Vec<f32> = (0..BANDS)
            .map(|b| tail_mean(&r.frames, BANDS_AT + b))
            .collect();
        let loudest = (0..BANDS)
            .max_by(|&a, &b| bands[a].total_cmp(&bands[b]))
            .unwrap();
        assert_eq!(loudest, 3, "bands {bands:?}");
        // RMS of a 0.5-amplitude sine is 0.354.
        let rms = tail_mean(&r.frames, RMS);
        assert!((rms - 0.3536).abs() < 0.01, "rms {rms}");
    }
}

#[test]
fn silence_and_noise_floor_stay_dark() {
    // ER-4: silence, and noise at -70 dBFS, must not be amplified into visuals or onsets.
    let sr = 44_100;
    let mut rng = fx::Rng::new(5);
    let noise: Vec<f32> = (0..sr * 4).map(|_| 0.000_3 * rng.bipolar()).collect();
    for signal in [vec![0.0f32; sr * 4], noise] {
        let r = analyze(&signal, Config::new(sr as f32));
        assert!(r.onsets.is_empty());
        for f in &r.frames {
            assert_eq!(f[GATE], 0.0);
            assert!(f[LOUDNESS] < 1e-6);
            for b in 0..BANDS {
                assert!(f[BANDS_AT + b] < 1e-6);
            }
            for m in 0..MEL_BANDS {
                assert!(f[MEL_AT + m] < 1e-6);
            }
        }
    }
}

#[test]
fn signal_fades_out_smoothly_when_it_stops() {
    let sr = 44_100;
    let mut s = fx::groove(sr, 120.0, 6.0, 1).mono();
    s.extend(std::iter::repeat_n(0.0, sr as usize * 2));
    let r = analyze(&s, Config::new(sr as f32));
    let last = r.frames.last().unwrap();
    assert_eq!(last[GATE], 0.0);
    assert!(last[LOUDNESS] < 0.01);
    // No single-frame jump from bright to black: the gate envelope fades.
    for w in r.frames.windows(2) {
        assert!((w[1][LOUDNESS] - w[0][LOUDNESS]).abs() < 0.5);
    }
}

#[test]
fn auto_gain_makes_quiet_and_loud_tracks_comparable() {
    let sr = 44_100;
    let loud = fx::groove(sr, 120.0, 20.0, 2).mono();
    let quiet: Vec<f32> = loud.iter().map(|s| s * 0.05).collect(); // -26 dB
    let rl = analyze(&loud, Config::new(sr as f32));
    let rq = analyze(&quiet, Config::new(sr as f32));
    for idx in [BANDS_AT + 1, LOUDNESS] {
        let (l, q) = (tail_mean(&rl.frames, idx), tail_mean(&rq.frames, idx));
        assert!(l > 0.1, "loud value {l} at {idx}");
        assert!((l - q).abs() < 0.1, "field {idx}: loud {l} vs quiet {q}");
    }
}

#[test]
fn onsets_on_click_tracks() {
    for &bpm in &fx::CLICK_BPMS {
        let f = fx::click_track(44_100, bpm, 20.0, 7);
        let r = analyze(&f.samples, Config::new(44_100.0));
        let m = f_measure(&r.onsets, &f.onsets, 0.07);
        println!(
            "click {bpm}: F={:.3} P={:.3} R={:.3}",
            m.f, m.precision, m.recall
        );
        assert!(m.f > 0.95, "click {bpm}: {m:?}");
    }
}

#[test]
fn onsets_on_groove() {
    for (sr, bpm) in [(48_000, 120.0), (44_100, 96.0)] {
        let f = fx::groove(sr, bpm, 30.0, 11);
        let r = analyze(&f.mono(), Config::new(sr as f32));
        let m = f_measure(&r.onsets, &f.onsets, 0.07);
        println!(
            "groove {bpm}@{sr}: F={:.3} P={:.3} R={:.3}",
            m.f, m.precision, m.recall
        );
        assert!(m.f > 0.9, "groove {bpm}: {m:?}");
    }
}

#[test]
fn onset_timing_bias_is_small() {
    let f = fx::click_track(44_100, 120.0, 20.0, 7);
    let r = analyze(&f.samples, Config::new(44_100.0));
    let mut errs: Vec<f64> = r
        .onsets
        .iter()
        .filter_map(|d| {
            f.onsets
                .iter()
                .map(|t| d - t)
                .min_by(|a, b| a.abs().total_cmp(&b.abs()))
        })
        .collect();
    errs.sort_by(f64::total_cmp);
    let median = errs[errs.len() / 2];
    println!("median onset timing error: {:.1} ms", median * 1000.0);
    assert!(median.abs() < 0.03);
}
