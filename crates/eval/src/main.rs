//! `pnpm eval` (PRD 9.2): runs the real-time analyzer over annotated audio and reports onset
//! F-measure (±70 ms, the standard MIR tolerance) and tempo accuracy (Acc1: within 4%; Acc2: also
//! allowing double, half, triple, or a third). Writes docs/evaluation.md and docs/evaluation.json.
//!
//! Beat F-measure needs the beat tracker (DSP-7, P1); until it exists the report says so.

use resonance_dsp::eval::{acc1, acc2, f_measure};
use resonance_dsp::frame::BPM;
use resonance_dsp::offline::{analyze, summarize};
use resonance_dsp::Config;
use resonance_fixtures::{self as fx, Fixture, Humanize};
use std::fmt::Write as _;
use std::path::Path;

mod decode;

const TOLERANCE: f64 = 0.07;
/** Beats are scored after this many seconds, once the online tracker has had time to lock. */
const BEAT_FROM: f64 = 8.0;

struct Row {
    set: &'static str,
    name: String,
    bpm: f64,
    estimate: f64,
    /// Fraction of frames after the first 8 s whose tempo estimate is within 4%.
    stable: f64,
    precision: f64,
    recall: f64,
    f: f64,
    n_truth: usize,
    /// Beat F-measure of the online tracker (DSP-7) and of the offline grid (DSP-9).
    beat_online: f64,
    beat_grid: f64,
}

fn from_time(ts: &[f64], from: f64) -> Vec<f64> {
    ts.iter().copied().filter(|&t| t >= from).collect()
}

fn evaluate(set: &'static str, f: &Fixture) -> Row {
    let cfg = Config::new(f.sample_rate as f32);
    let r = analyze(&f.mono(), cfg);
    let truth = f.bpm.unwrap_or(0.0) as f64;
    let after: Vec<f64> = r
        .frames
        .iter()
        .zip(&r.times)
        .filter(|(_, &t)| t >= 8.0)
        .map(|(fr, _)| fr[BPM] as f64)
        .collect();
    let stable =
        after.iter().filter(|&&b| acc1(b, truth)).count() as f64 / after.len().max(1) as f64;
    let m = f_measure(&r.onsets, &f.onsets, TOLERANCE);
    let mono = f.mono();
    let grid = summarize(&mono, cfg, 10).beats;
    let beat_online = f_measure(
        &from_time(&r.beats, BEAT_FROM),
        &from_time(&f.beats, BEAT_FROM),
        TOLERANCE,
    )
    .f;
    let beat_grid = f_measure(&grid, &f.beats, TOLERANCE).f;
    Row {
        set,
        name: f.name.clone(),
        bpm: truth,
        estimate: r.frames.last().map_or(0.0, |fr| fr[BPM] as f64),
        stable,
        precision: m.precision,
        recall: m.recall,
        f: m.f,
        n_truth: f.onsets.len(),
        beat_online,
        beat_grid,
    }
}

/// A real song with a hand-made `.beats` annotation: beat F (online after 8 s, offline grid) and
/// tempo from the annotation's median inter-beat interval. Onsets aren't annotated.
struct RealRow {
    id: String,
    truth_bpm: f64,
    estimate: f64,
    beat_online: f64,
    beat_grid: f64,
    n_beats: usize,
}

fn evaluate_real(id: &str) -> Option<RealRow> {
    let ann = std::fs::read_to_string(format!("eval/annotations/{id}.beats")).ok()?;
    let truth: Vec<f64> = ann.lines().filter_map(|l| l.trim().parse().ok()).collect();
    if truth.len() < 8 {
        return None;
    }
    let (mono, sr) =
        match decode::decode_mono(&format!("packages/web/public/audio/tracks/{id}.mp3")) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("skipping {id}: {e}");
                return None;
            }
        };
    let cfg = Config::new(sr as f32);
    let r = analyze(&mono, cfg);
    let s = summarize(&mono, cfg, 10);
    let mut ibis: Vec<f64> = truth.windows(2).map(|w| w[1] - w[0]).collect();
    ibis.sort_by(f64::total_cmp);
    Some(RealRow {
        id: id.into(),
        truth_bpm: 60.0 / ibis[ibis.len() / 2],
        estimate: s.bpm as f64,
        beat_online: f_measure(
            &from_time(&r.beats, BEAT_FROM),
            &from_time(&truth, BEAT_FROM),
            TOLERANCE,
        )
        .f,
        beat_grid: f_measure(&s.beats, &truth, TOLERANCE).f,
        n_beats: truth.len(),
    })
}

fn mean(xs: impl Iterator<Item = f64>) -> f64 {
    let v: Vec<f64> = xs.collect();
    v.iter().sum::<f64>() / v.len().max(1) as f64
}

fn main() -> std::io::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "docs/evaluation.md".into());
    let mut rows = Vec::new();

    for &bpm in &fx::CLICK_BPMS {
        rows.push(evaluate(
            "Click tracks",
            &fx::click_track(44_100, bpm, 30.0, 7),
        ));
    }
    rows.push(evaluate(
        "Clean grooves",
        &fx::groove(48_000, 120.0, 30.0, 11),
    ));
    rows.push(evaluate(
        "Clean grooves",
        &fx::groove(44_100, 96.0, 30.0, 13),
    ));
    let h = Humanize {
        jitter: 0.008,
        swing: 0.08,
        velocity: 0.35,
        noise: 0.01,
    };
    for (i, bpm) in [85.0, 100.0, 118.0, 124.0, 128.0, 140.0, 165.0]
        .into_iter()
        .enumerate()
    {
        let sr = if i % 2 == 0 { 44_100 } else { 48_000 };
        rows.push(evaluate(
            "Humanized grooves",
            &fx::groove_humanized(sr, bpm, 40.0, 100 + i as u64, h),
        ));
    }

    // Real songs: scored only when a hand-made annotation exists (see eval/annotations/README.md).
    let real = ["deep-house-soul", "morning-assembly", "play-house-free"];
    let annotated: Vec<RealRow> = real.iter().filter_map(|id| evaluate_real(id)).collect();

    // Markdown.
    let mut md = String::new();
    let _ = writeln!(md, "# Evaluation\n");
    let _ = writeln!(
        md,
        "Generated by `pnpm eval` (`crates/eval`). Don't edit by hand. Raw values: \
         [evaluation.json](evaluation.json).\n"
    );
    let _ = writeln!(md, "## Summary\n");
    let _ = writeln!(
        md,
        "| Set | Tracks | Onset F (±70 ms) | Tempo Acc1 | Tempo Acc2 | Beat F, online (after 8 s) | Beat F, offline grid |"
    );
    let _ = writeln!(md, "|---|---|---|---|---|---|---|");
    for set in ["Click tracks", "Clean grooves", "Humanized grooves"] {
        let s: Vec<&Row> = rows.iter().filter(|r| r.set == set).collect();
        let a1 = s.iter().filter(|r| acc1(r.estimate, r.bpm)).count();
        let a2 = s.iter().filter(|r| acc2(r.estimate, r.bpm)).count();
        let _ = writeln!(
            md,
            "| {set} | {} | {:.3} | {}/{} | {}/{} | {:.3} | {:.3} |",
            s.len(),
            mean(s.iter().map(|r| r.f)),
            a1,
            s.len(),
            a2,
            s.len(),
            mean(s.iter().map(|r| r.beat_online)),
            mean(s.iter().map(|r| r.beat_grid)),
        );
    }
    if annotated.is_empty() {
        let _ = writeln!(
            md,
            "| Bundled songs (real music) | {} | not annotated yet | | | | |\n",
            real.len()
        );
    } else {
        let a1 = annotated
            .iter()
            .filter(|r| acc1(r.estimate, r.truth_bpm))
            .count();
        let a2 = annotated
            .iter()
            .filter(|r| acc2(r.estimate, r.truth_bpm))
            .count();
        let _ = writeln!(
            md,
            "| Bundled songs (real music, hand-tapped) | {} | not annotated | {a1}/{n} | {a2}/{n} | {:.3} | {:.3} |\n",
            annotated.len(),
            mean(annotated.iter().map(|r| r.beat_online)),
            mean(annotated.iter().map(|r| r.beat_grid)),
            n = annotated.len(),
        );
        let _ = writeln!(md, "### Real songs\n");
        let _ = writeln!(
            md,
            "| Track | Annotated beats | Tapped BPM | Estimate | Beat F online | Beat F grid |"
        );
        let _ = writeln!(md, "|---|---|---|---|---|---|");
        for r in &annotated {
            let _ = writeln!(
                md,
                "| {} | {} | {:.1} | {:.1} | {:.3} | {:.3} |",
                r.id, r.n_beats, r.truth_bpm, r.estimate, r.beat_online, r.beat_grid
            );
        }
        let _ = writeln!(md);
    }

    let _ = writeln!(md, "## Per track\n");
    let _ = writeln!(
        md,
        "| Set | Track | True BPM | Estimate | Acc1 | Acc2 | Tempo stable after 8 s | Onsets | P | R | F | Beat F online | Beat F grid |"
    );
    let _ = writeln!(md, "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for r in &rows {
        let _ = writeln!(
            md,
            "| {} | {} | {:.0} | {:.1} | {} | {} | {:.0}% | {} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} |",
            r.set,
            r.name,
            r.bpm,
            r.estimate,
            if acc1(r.estimate, r.bpm) { "yes" } else { "no" },
            if acc2(r.estimate, r.bpm) { "yes" } else { "no" },
            r.stable * 100.0,
            r.n_truth,
            r.precision,
            r.recall,
            r.f,
            r.beat_online,
            r.beat_grid
        );
    }
    let _ = writeln!(
        md,
        r#"
## Method

- **Analyzer:** the same real-time Rust code the browser runs (`crates/dsp`), fed hop by hop,
  causal, at the fixture's own sample rate. No offline look-ahead.
- **Onsets:** each detection is attributed to the frame before the one that flagged it (peak
  picking needs one frame of look-ahead), at that frame's window centre. Matching is one-to-one
  within ±70 ms, closest pairs first, as in mir_eval.
- **Tempo:** the estimate at the end of the track. Acc1 counts it if it's within 4% of the truth;
  Acc2 also accepts double, half, triple, or a third. "Tempo stable" is the share of frames after
  the first 8 s whose estimate meets Acc1.
- **Datasets:**
  - *Click tracks:* 30 s at 70, 90, 120, 140, and 174 BPM.
  - *Clean grooves:* kick, off-beat hats, and a chord pad, 30 s, at 120 BPM (48 kHz) and 96 BPM
    (44.1 kHz).
  - *Humanized grooves:* 40 s at seven tempos, with 8 ms (1 sd) timing jitter on every hit,
    light swing, ±35% velocity, a syncopated extra kick every other bar, and a -40 dBFS noise
    floor. Onset truth is the jittered hit times; beat truth is the nominal grid.

## Honest caveats

- **Synthetic audio is an upper bound.** Every dataset here is generated, so ground truth is
  exact, but synthetic drums are cleaner than real mixes. The onset detector's one tuned
  parameter (the per-bin flux floor) was chosen on the clean grooves, so those numbers are
  optimistic. The humanized grooves use tempos and variations that weren't used for tuning.
- **Beats** are scored against the nominal grid (where a listener taps). The online tracker
  (DSP-7) is causal and predicts beats ahead of time, so it's scored after 8 s, once it has
  locked; the offline grid (DSP-9) sees the whole file and is scored throughout.
- **Real music** is scored only from beat annotations tapped by a person with the annotation
  tool (`/annotate.html` on the dev server; see eval/annotations/README.md). They are never
  generated from Resonance's own output, because that would make the evaluation circular.
"#
    );
    std::fs::write(&out, md)?;

    let mut json = String::from("[\n");
    for (i, r) in rows.iter().enumerate() {
        let _ = writeln!(
            json,
            "  {{\"set\": \"{}\", \"track\": \"{}\", \"bpm\": {}, \"estimate\": {:.3}, \"acc1\": {}, \"acc2\": {}, \"stable\": {:.4}, \"precision\": {:.4}, \"recall\": {:.4}, \"f\": {:.4}, \"beatOnline\": {:.4}, \"beatGrid\": {:.4}}}{}",
            r.set,
            r.name,
            r.bpm,
            r.estimate,
            acc1(r.estimate, r.bpm),
            acc2(r.estimate, r.bpm),
            r.stable,
            r.precision,
            r.recall,
            r.f,
            r.beat_online,
            r.beat_grid,
            if i + 1 < rows.len() { "," } else { "" }
        );
    }
    json.push_str("]\n");
    std::fs::write(Path::new(&out).with_extension("json"), json)?;
    eprintln!("wrote {out}");
    Ok(())
}
