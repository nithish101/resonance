//! Beat tracking (DSP-7), offline beat grid (DSP-9), chroma and key (DSP-8) on synthetic audio
//! with known answers (PRD 9.1).

use resonance_dsp::chroma::estimate_key;
use resonance_dsp::eval::f_measure;
use resonance_dsp::frame::*;
use resonance_dsp::offline::{analyze, summarize};
use resonance_dsp::Config;
use resonance_fixtures::{self as fx, Humanize};

fn after(ts: &[f64], from: f64) -> Vec<f64> {
    ts.iter().copied().filter(|&t| t >= from).collect()
}

#[test]
fn online_beats_lock_to_click_tracks() {
    for &bpm in &fx::CLICK_BPMS {
        let f = fx::click_track(44_100, bpm, 30.0, 7);
        let r = analyze(&f.samples, Config::new(44_100.0));
        // Score after the tracker has had time to lock (tempo needs ~3 s, phase a few beats).
        let m = f_measure(&after(&r.beats, 8.0), &after(&f.beats, 8.0), 0.07);
        println!("online beats, click {bpm}: F={:.3}", m.f);
        assert!(m.f > 0.9, "click {bpm}: {m:?}");
    }
}

#[test]
fn online_beats_on_humanized_groove_and_phase_ramps() {
    let h = Humanize {
        jitter: 0.008,
        swing: 0.08,
        velocity: 0.35,
        noise: 0.01,
    };
    let f = fx::groove_humanized(48_000, 124.0, 40.0, 3, h);
    let r = analyze(&f.mono(), Config::new(48_000.0));
    let m = f_measure(&after(&r.beats, 8.0), &after(&f.beats, 8.0), 0.07);
    println!("online beats, humanized 124: F={:.3}", m.f);
    assert!(m.f > 0.85, "{m:?}");
    // Phase rises between beats and wraps at each beat.
    let phases: Vec<f32> = r
        .frames
        .iter()
        .skip(1200)
        .take(200)
        .map(|fr| fr[BEAT_PHASE])
        .collect();
    assert!(phases.iter().any(|&p| p > 0.8) && phases.iter().any(|&p| p < 0.2));
}

#[test]
fn offline_beat_grid_matches_annotations() {
    let h = Humanize {
        jitter: 0.008,
        swing: 0.08,
        velocity: 0.35,
        noise: 0.01,
    };
    for (sr, bpm) in [(44_100u32, 96.0f32), (48_000, 128.0), (44_100, 150.0)] {
        let f = fx::groove_humanized(sr, bpm, 40.0, 9, h);
        let s = summarize(&f.mono(), Config::new(sr as f32), 100);
        let m = f_measure(&s.beats, &f.beats, 0.07);
        println!(
            "offline grid, humanized {bpm}: F={:.3} ({} beats, tempo {:.1})",
            m.f,
            s.beats.len(),
            s.bpm
        );
        assert!(m.f > 0.9, "{bpm}: {m:?}");
        assert_eq!(s.energy.len(), 100);
        assert!(s.energy.iter().all(|&e| (0.0..=1.0).contains(&e)));
    }
}

fn chord(sr: u32, notes: &[f32], secs: f32) -> Vec<f32> {
    let n = (sr as f32 * secs) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / sr as f32;
            notes
                .iter()
                .map(|&m| {
                    let f = 440.0 * 2f32.powf((m - 69.0) / 12.0);
                    (std::f32::consts::TAU * f * t).sin()
                        + 0.3 * (std::f32::consts::TAU * 2.0 * f * t).sin()
                })
                .sum::<f32>()
                * 0.2
        })
        .collect()
}

#[test]
fn chroma_peaks_on_chord_tones() {
    // C major triad (C4 E4 G4) and A minor triad (A3 C4 E4).
    for (notes, pcs) in [
        (vec![60.0, 64.0, 67.0], [0usize, 4, 7]),
        (vec![57.0, 60.0, 64.0], [9, 0, 4]),
    ] {
        let r = analyze(&chord(44_100, &notes, 3.0), Config::new(44_100.0));
        let last = r.frames.last().unwrap();
        let chroma = &last[CHROMA_AT..CHROMA_AT + CHROMA];
        let mut order: Vec<usize> = (0..12).collect();
        order.sort_by(|&a, &b| chroma[b].total_cmp(&chroma[a]));
        let mut top3 = order[..3].to_vec();
        top3.sort();
        let mut want = pcs.to_vec();
        want.sort();
        assert_eq!(top3, want, "chroma {chroma:?}");
    }
}

#[test]
fn key_of_scales() {
    // A C major scale and an A natural-minor scale, one note per 0.4 s, played twice.
    let major = [60.0, 62.0, 64.0, 65.0, 67.0, 69.0, 71.0, 72.0];
    let minor = [
        57.0, 59.0, 60.0, 62.0, 64.0, 65.0, 67.0, 69.0, 64.0, 60.0, 57.0,
    ];
    for (notes, key) in [(&major[..], 0), (&minor[..], 12 + 9)] {
        let mut sig = Vec::new();
        for _ in 0..2 {
            for &n in notes {
                // Emphasize the tonic triad slightly, as real music does.
                sig.extend(chord(44_100, &[n], 0.4));
            }
        }
        let r = analyze(&sig, Config::new(44_100.0));
        let k = r.frames.last().unwrap()[KEY] as i32;
        assert_eq!(k, key, "expected key {key}, got {k}");
    }
}

#[test]
fn key_profiles_identify_themselves() {
    // Each rotated profile must be classified as its own key.
    use resonance_dsp::chroma::{MAJOR_PROFILE, MINOR_PROFILE};
    for tonic in 0..12 {
        for (mode, p) in [(0, MAJOR_PROFILE), (12, MINOR_PROFILE)] {
            let mut c = [0.0f32; 12];
            for pc in 0..12 {
                c[(pc + tonic) % 12] = p[pc];
            }
            assert_eq!(estimate_key(&c).0, mode + tonic as i32);
        }
    }
}

#[test]
fn groove_key_is_detected() {
    let f = fx::groove(44_100, 120.0, 20.0, 1); // C major progression
    let s = summarize(&f.mono(), Config::new(44_100.0), 50);
    assert_eq!(s.key, 0, "C major expected, got {}", s.key);
}
