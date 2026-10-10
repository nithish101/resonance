//! Tempo (PRD 9.1): click tracks at 70, 90, 120, 140, and 174 BPM must be detected within
//! ±2 BPM. Half/double-tempo answers are reported separately, and they fail this test.

use resonance_dsp::frame::{BPM, TEMPO_CONFIDENCE};
use resonance_dsp::offline::analyze;
use resonance_dsp::Config;
use resonance_fixtures as fx;

fn final_bpm(mono: &[f32], sr: u32) -> (f32, f32) {
    let r = analyze(mono, Config::new(sr as f32));
    let last = r.frames.last().unwrap();
    (last[BPM], last[TEMPO_CONFIDENCE])
}

fn classify(est: f32, truth: f32) -> &'static str {
    if (est - truth).abs() <= 2.0 {
        "exact"
    } else if (est - 2.0 * truth).abs() <= 4.0 {
        "double"
    } else if (est - truth / 2.0).abs() <= 1.0 {
        "half"
    } else {
        "wrong"
    }
}

#[test]
fn click_tracks_within_2_bpm() {
    let mut failures = Vec::new();
    for sr in [44_100u32, 48_000] {
        for &bpm in &fx::CLICK_BPMS {
            let f = fx::click_track(sr, bpm, 20.0, 7);
            let (est, conf) = final_bpm(&f.samples, sr);
            let class = classify(est, bpm);
            println!("{sr} Hz, click {bpm}: {est:.2} BPM (confidence {conf:.2}) -> {class}");
            if class != "exact" {
                failures.push((sr, bpm, est, class));
            }
        }
    }
    assert!(failures.is_empty(), "{failures:?}");
}

#[test]
fn grooves_within_2_bpm() {
    for (sr, bpm) in [(48_000, 120.0), (44_100, 96.0)] {
        let f = fx::groove(sr, bpm, 30.0, 11);
        let (est, _) = final_bpm(&f.mono(), sr);
        println!("groove {bpm}: {est:.2} -> {}", classify(est, bpm));
        assert!((est - bpm).abs() <= 2.0, "groove {bpm}: {est}");
    }
}

#[test]
fn follows_a_tempo_change() {
    // 15 s at 100 BPM, then 15 s at 130 BPM: within 8 s of the change the estimate moves.
    let sr = 44_100;
    let mut s = fx::click_track(sr, 100.0, 15.0, 1).samples;
    s.extend(fx::click_track(sr, 130.0, 15.0, 2).samples);
    let r = analyze(&s, Config::new(sr as f32));
    let at = |secs: f64| {
        let i = r.times.iter().position(|&t| t >= secs).unwrap();
        r.frames[i][BPM]
    };
    assert!(
        (at(14.0) - 100.0).abs() <= 2.0,
        "before change: {}",
        at(14.0)
    );
    assert!(
        (at(23.0) - 130.0).abs() <= 2.0,
        "after change: {}",
        at(23.0)
    );
}

#[test]
fn silence_has_no_tempo() {
    let (est, conf) = final_bpm(&vec![0.0; 44_100 * 10], 44_100);
    assert_eq!(est, 0.0);
    assert_eq!(conf, 0.0);
}
