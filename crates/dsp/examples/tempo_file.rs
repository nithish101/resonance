//! Dev tool: prints the tempo estimate over time for a 16-bit WAV file.
//! `cargo run --release --example tempo_file -p resonance-dsp -- track.wav`
use resonance_dsp::frame::{BPM, TEMPO_CONFIDENCE};
use resonance_dsp::{offline::analyze, Config};
fn main() {
    let path = std::env::args().nth(1).expect("path");
    let b = std::fs::read(&path).unwrap();
    let mut i = 12;
    let (mut sr, mut data) = (44_100u32, &b[..0]);
    while i + 8 <= b.len() {
        let id = &b[i..i + 4];
        let len = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
        if id == b"fmt " {
            sr = u32::from_le_bytes(b[i + 12..i + 16].try_into().unwrap());
        }
        if id == b"data" {
            data = &b[i + 8..(i + 8 + len).min(b.len())];
            break;
        }
        i += 8 + len;
    }
    let mono: Vec<f32> = data
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
        .collect();
    let r = analyze(&mono, Config::new(sr as f32));
    let step = r.frames.len() / 8;
    let ests: Vec<String> = (1..=8)
        .map(|k| {
            let f = &r.frames[(k * step).min(r.frames.len() - 1)];
            format!("{:.1}({:.2})", f[BPM], f[TEMPO_CONFIDENCE])
        })
        .collect();
    println!(
        "{path}: onsets/s {:.2}  bpm over time: {}",
        r.onsets.len() as f64 / (mono.len() as f64 / sr as f64),
        ests.join(" ")
    );
}
