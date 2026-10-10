//! Deterministic synthetic audio for tests, evaluation, and the visual-regression suite.
//!
//! Every generator is a pure function of its arguments (the PRNG is seeded), so the same call
//! always produces bit-identical samples. Each fixture also carries exact ground truth: the
//! times of every beat and onset, the tempo, and the key where one exists.

use std::f32::consts::TAU;

/// A generated mono or interleaved-stereo signal plus its ground truth.
#[derive(Debug, Clone)]
pub struct Fixture {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved samples in [-1, 1].
    pub samples: Vec<f32>,
    pub bpm: Option<f32>,
    /// Beat times in seconds.
    pub beats: Vec<f64>,
    /// Onset times in seconds (every percussive or harmonic attack).
    pub onsets: Vec<f64>,
    /// Key as a name such as "C major", when the fixture has tonal content.
    pub key: Option<String>,
}

impl Fixture {
    /// Mono downmix (average of channels).
    pub fn mono(&self) -> Vec<f32> {
        let ch = self.channels as usize;
        self.samples
            .chunks_exact(ch)
            .map(|f| f.iter().sum::<f32>() / ch as f32)
            .collect()
    }

    pub fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / self.channels as f64 / self.sample_rate as f64
    }
}

/// xorshift64*: tiny, fast, and fully deterministic across platforms.
#[derive(Debug, Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// Uniform in [-1, 1).
    pub fn bipolar(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
    }
}

fn add(buf: &mut [f32], start: usize, src: impl Iterator<Item = f32>) {
    for (dst, s) in buf.iter_mut().skip(start).zip(src) {
        *dst += s;
    }
}

/// A 20 ms click: a 1.5 kHz tone burst plus a little noise, with an exponential decay.
fn click(sr: f32, rng: &mut Rng) -> Vec<f32> {
    let n = (0.02 * sr) as usize;
    (0..n)
        .map(|i| {
            let t = i as f32 / sr;
            let env = (-t / 0.004).exp();
            env * (0.8 * (TAU * 1500.0 * t).sin() + 0.2 * rng.bipolar())
        })
        .collect()
}

/// Kick drum: a sine sweeping 140 -> 45 Hz with a 250 ms decay.
fn kick(sr: f32) -> Vec<f32> {
    let n = (0.35 * sr) as usize;
    let mut phase = 0.0f32;
    (0..n)
        .map(|i| {
            let t = i as f32 / sr;
            let f = 45.0 + 95.0 * (-t / 0.04).exp();
            phase += TAU * f / sr;
            (-t / 0.25).exp() * phase.sin()
        })
        .collect()
}

/// Closed hi-hat: first-difference (high-passed) noise with a 35 ms decay.
fn hat(sr: f32, rng: &mut Rng) -> Vec<f32> {
    let n = (0.08 * sr) as usize;
    let mut prev = 0.0f32;
    (0..n)
        .map(|i| {
            let t = i as f32 / sr;
            let x = rng.bipolar();
            let y = x - prev;
            prev = x;
            0.5 * (-t / 0.035).exp() * y
        })
        .collect()
}

fn midi_hz(note: u8) -> f32 {
    440.0 * 2f32.powf((note as f32 - 69.0) / 12.0)
}

/// A soft pad voicing of `notes`, `len` seconds long, with three harmonics per note.
fn pad(sr: f32, notes: &[u8], len: f32) -> Vec<f32> {
    let n = (len * sr) as usize;
    let attack = 0.03 * sr;
    let release = 0.08 * sr;
    (0..n)
        .map(|i| {
            let fi = i as f32;
            let env = (fi / attack).min(1.0) * ((n as f32 - fi) / release).min(1.0);
            let t = fi / sr;
            let s: f32 = notes
                .iter()
                .map(|&m| {
                    let f = midi_hz(m);
                    (TAU * f * t).sin()
                        + 0.4 * (TAU * 2.0 * f * t).sin()
                        + 0.2 * (TAU * 3.0 * f * t).sin()
                })
                .sum();
            env * s / notes.len() as f32
        })
        .collect()
}

fn normalize(samples: &mut [f32], peak: f32) {
    let max = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    if max > 0.0 {
        let g = peak / max;
        samples.iter_mut().for_each(|s| *s *= g);
    }
}

/// A click on every beat. `lead_in` seconds of silence before the first click.
pub fn click_track(sample_rate: u32, bpm: f32, seconds: f32, seed: u64) -> Fixture {
    let sr = sample_rate as f32;
    let mut rng = Rng::new(seed);
    let mut samples = vec![0.0f32; (seconds * sr) as usize];
    let period = 60.0 / bpm as f64;
    let lead_in = 0.5f64;
    let mut beats = Vec::new();
    let mut t = lead_in;
    while t < seconds as f64 - 0.05 {
        let c = click(sr, &mut rng);
        add(
            &mut samples,
            (t * sr as f64).round() as usize,
            c.into_iter(),
        );
        beats.push(t);
        t += period;
    }
    normalize(&mut samples, 0.8);
    Fixture {
        name: format!("click-{bpm}"),
        sample_rate,
        channels: 1,
        samples,
        bpm: Some(bpm),
        onsets: beats.clone(),
        beats,
        key: None,
    }
}

/// Kick on every beat, hi-hats on the off-beat eighths, and a I-V-vi-IV pad progression in
/// C major changing every bar. Rendered as stereo (hats panned slightly right).
pub fn groove(sample_rate: u32, bpm: f32, seconds: f32, seed: u64) -> Fixture {
    let sr = sample_rate as f32;
    let mut rng = Rng::new(seed);
    let frames = (seconds * sr) as usize;
    let mut left = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    let beat = 60.0 / bpm as f64;
    let lead_in = 0.5f64;
    // C, G, Am, F voiced around middle C.
    let chords: [&[u8]; 4] = [
        &[48, 60, 64, 67],
        &[43, 59, 62, 67],
        &[45, 60, 64, 69],
        &[41, 60, 65, 69],
    ];
    let mut beats = Vec::new();
    let mut onsets = Vec::new();
    let mut i = 0usize;
    loop {
        let t = lead_in + i as f64 * beat;
        if t > seconds as f64 - 0.4 {
            break;
        }
        let at = (t * sr as f64).round() as usize;
        let k = kick(sr);
        add(&mut left, at, k.iter().map(|s| 0.9 * s));
        add(&mut right, at, k.iter().map(|s| 0.9 * s));
        beats.push(t);
        onsets.push(t);
        if i % 4 == 0 {
            let chord = chords[(i / 4) % chords.len()];
            let len = (4.0 * beat) as f32;
            let p = pad(sr, chord, len.min(seconds - t as f32));
            add(&mut left, at, p.iter().map(|s| 0.35 * s));
            add(&mut right, at, p.iter().map(|s| 0.35 * s));
        }
        let off = t + beat / 2.0;
        if off < seconds as f64 - 0.1 {
            let h = hat(sr, &mut rng);
            let at = (off * sr as f64).round() as usize;
            add(&mut left, at, h.iter().map(|s| 0.7 * s));
            add(&mut right, at, h.iter().copied());
            onsets.push(off);
        }
        i += 1;
    }
    let mut samples: Vec<f32> = left
        .iter()
        .zip(&right)
        .flat_map(|(l, r)| [*l, *r])
        .collect();
    normalize(&mut samples, 0.85);
    Fixture {
        name: format!("groove-{bpm}"),
        sample_rate,
        channels: 2,
        samples,
        bpm: Some(bpm),
        beats,
        onsets,
        key: Some("C major".into()),
    }
}

/// Options for [`groove_humanized`].
#[derive(Debug, Clone, Copy)]
pub struct Humanize {
    /// Standard deviation of per-hit timing jitter, seconds.
    pub jitter: f64,
    /// Off-beat hats are delayed by this fraction of a beat (0 = straight, 0.1 = light swing).
    pub swing: f64,
    /// Per-hit gain variation, as a fraction (0.3 = +-30%).
    pub velocity: f32,
    /// Broadband noise floor, relative to full scale (e.g. 0.01 = -40 dBFS).
    pub noise: f32,
}

/// A less tidy groove for evaluation: like [`groove`] but with timing jitter, swing, velocity
/// variation, an extra syncopated kick in every other bar, and a noise floor. Beats are the
/// nominal grid (where a listener taps); onsets are the actual, jittered hit times.
pub fn groove_humanized(
    sample_rate: u32,
    bpm: f32,
    seconds: f32,
    seed: u64,
    h: Humanize,
) -> Fixture {
    let sr = sample_rate as f32;
    let mut rng = Rng::new(seed);
    // Sum of uniforms: a cheap, deterministic, approximately normal variate (unit variance).
    let gauss = |rng: &mut Rng| -> f64 { (0..12).map(|_| rng.bipolar() as f64 * 0.5).sum() };
    let frames = (seconds * sr) as usize;
    let mut mono = vec![0.0f32; frames];
    let beat = 60.0 / bpm as f64;
    let lead_in = 0.5f64;
    let chords: [&[u8]; 4] = [
        &[45, 57, 60, 64],
        &[41, 57, 60, 65],
        &[48, 55, 60, 64],
        &[43, 55, 59, 62],
    ];
    let mut beats = Vec::new();
    let mut onsets = Vec::new();
    let mut i = 0usize;
    loop {
        let grid = lead_in + i as f64 * beat;
        if grid > seconds as f64 - 0.5 {
            break;
        }
        beats.push(grid);
        let t = (grid + h.jitter * gauss(&mut rng)).max(0.0);
        let g = 1.0 + h.velocity * rng.bipolar();
        add(
            &mut mono,
            (t * sr as f64).round() as usize,
            kick(sr).into_iter().map(|s| 0.8 * g * s),
        );
        onsets.push(t);
        if i % 4 == 0 {
            let chord = chords[(i / 4) % chords.len()];
            let p = pad(sr, chord, (4.0 * beat) as f32);
            add(
                &mut mono,
                (t * sr as f64).round() as usize,
                p.into_iter().map(|s| 0.3 * s),
            );
        }
        // Syncopated extra kick on the "and" of beat 3, every other bar.
        if i % 8 == 2 {
            let t2 = grid + beat * 0.5 + h.jitter * gauss(&mut rng);
            add(
                &mut mono,
                (t2 * sr as f64).round() as usize,
                kick(sr).into_iter().map(|s| 0.55 * s),
            );
            onsets.push(t2);
        }
        let off = grid + beat * (0.5 + h.swing) + h.jitter * gauss(&mut rng);
        if off < seconds as f64 - 0.1 {
            let g = 1.0 + h.velocity * rng.bipolar();
            add(
                &mut mono,
                (off * sr as f64).round() as usize,
                hat(sr, &mut rng).into_iter().map(|s| 0.6 * g * s),
            );
            onsets.push(off);
        }
        i += 1;
    }
    for s in mono.iter_mut() {
        *s += h.noise * rng.bipolar();
    }
    normalize(&mut mono, 0.85);
    onsets.sort_by(f64::total_cmp);
    Fixture {
        name: format!("humanized-{bpm}"),
        sample_rate,
        channels: 1,
        samples: mono,
        bpm: Some(bpm),
        beats,
        onsets,
        key: Some("A minor".into()),
    }
}

/// A pure sine, used to check that a known frequency arrives where expected end to end.
pub fn sine(sample_rate: u32, hz: f32, seconds: f32) -> Fixture {
    let sr = sample_rate as f32;
    let samples = (0..(seconds * sr) as usize)
        .map(|i| 0.5 * (TAU * hz * i as f32 / sr).sin())
        .collect();
    Fixture {
        name: format!("sine-{hz}"),
        sample_rate,
        channels: 1,
        samples,
        bpm: None,
        beats: vec![],
        onsets: vec![],
        key: None,
    }
}

/// The tempos the click-track tests and the eval use (PRD 9.1).
pub const CLICK_BPMS: [f32; 5] = [70.0, 90.0, 120.0, 140.0, 174.0];

/// Every fixture written to disk by the `resonance-fixtures` binary.
pub fn all() -> Vec<Fixture> {
    let mut v: Vec<Fixture> = CLICK_BPMS
        .iter()
        .map(|&b| click_track(44_100, b, 20.0, 7))
        .collect();
    v.push(groove(48_000, 120.0, 30.0, 11));
    v.push(groove(44_100, 96.0, 30.0, 13));
    v.push(sine(44_100, 1000.0, 5.0));
    v
}

/// 16-bit PCM WAV bytes.
pub fn to_wav(f: &Fixture) -> Vec<u8> {
    let data_len = (f.samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    let byte_rate = f.sample_rate * f.channels as u32 * 2;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&f.channels.to_le_bytes());
    out.extend_from_slice(&f.sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&(f.channels * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in &f.samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generators_are_deterministic() {
        let a = groove(48_000, 120.0, 4.0, 11);
        let b = groove(48_000, 120.0, 4.0, 11);
        assert_eq!(a.samples, b.samples);
        assert_eq!(to_wav(&a), to_wav(&b));
    }

    #[test]
    fn click_beats_are_evenly_spaced() {
        let f = click_track(44_100, 120.0, 10.0, 1);
        for w in f.beats.windows(2) {
            assert!((w[1] - w[0] - 0.5).abs() < 1e-9);
        }
        assert_eq!(f.beats.len(), 19);
    }

    #[test]
    fn wav_header_is_well_formed() {
        let f = sine(44_100, 1000.0, 0.1);
        let w = to_wav(&f);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 44_100);
        assert_eq!(w.len(), 44 + f.samples.len() * 2);
    }

    #[test]
    fn mono_downmix_averages_channels() {
        let f = groove(44_100, 120.0, 1.0, 3);
        let m = f.mono();
        assert_eq!(m.len(), f.samples.len() / 2);
        assert!((m[1000] - (f.samples[2000] + f.samples[2001]) / 2.0).abs() < 1e-7);
    }
}
