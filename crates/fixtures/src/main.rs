//! Writes every fixture as a WAV file plus beat/onset annotations and a manifest.
//!
//! Usage: `resonance-fixtures <out-dir>`

use std::fmt::Write as _;
use std::{env, fs, path::PathBuf};

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ *b as u64).wrapping_mul(0x0100_0000_01b3)
    })
}

fn times(ts: &[f64]) -> String {
    ts.iter().fold(String::new(), |mut s, t| {
        let _ = writeln!(s, "{t:.6}");
        s
    })
}

fn main() -> std::io::Result<()> {
    let out = PathBuf::from(env::args().nth(1).unwrap_or_else(|| "fixtures".into()));
    fs::create_dir_all(&out)?;
    let mut manifest = String::from("[\n");
    let all = resonance_fixtures::all();
    for (i, f) in all.iter().enumerate() {
        let wav = resonance_fixtures::to_wav(f);
        fs::write(out.join(format!("{}.wav", f.name)), &wav)?;
        fs::write(out.join(format!("{}.beats.txt", f.name)), times(&f.beats))?;
        fs::write(out.join(format!("{}.onsets.txt", f.name)), times(&f.onsets))?;
        let _ = writeln!(
            manifest,
            "  {{\"name\": \"{}\", \"file\": \"{}.wav\", \"sampleRate\": {}, \"channels\": {}, \"duration\": {:.3}, \"bpm\": {}, \"key\": {}, \"fnv1a\": \"{:016x}\"}}{}",
            f.name,
            f.name,
            f.sample_rate,
            f.channels,
            f.duration_secs(),
            f.bpm.map_or("null".into(), |b| b.to_string()),
            f.key.as_ref().map_or("null".into(), |k| format!("\"{k}\"")),
            fnv1a(&wav),
            if i + 1 < all.len() { "," } else { "" }
        );
    }
    manifest.push_str("]\n");
    fs::write(out.join("manifest.json"), manifest)?;
    eprintln!("wrote {} fixtures to {}", all.len(), out.display());
    Ok(())
}
