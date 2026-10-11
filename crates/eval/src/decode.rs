//! MP3 decoding for the real-song evaluation (pure Rust, via symphonia). Returns a mono downmix
//! at the file's own sample rate.

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub fn decode_mono(path: &str) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("{path}: {e}"))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("no audio track")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let mut mono = Vec::new();
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else {
            continue; // skip corrupt frames
        };
        let spec = *decoded.spec();
        rate = spec.rate;
        let ch = spec.channels.count();
        let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buf.copy_interleaved_ref(decoded);
        mono.extend(
            buf.samples()
                .chunks_exact(ch)
                .map(|f| f.iter().sum::<f32>() / ch as f32),
        );
    }
    Ok((mono, rate))
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_a_bundled_track() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/web/public/audio/tracks/morning-assembly.mp3"
        );
        let (mono, rate) = super::decode_mono(path).unwrap();
        assert_eq!(rate, 44_100);
        let secs = mono.len() as f64 / rate as f64;
        assert!((secs - 190.5).abs() < 1.0, "duration {secs}");
        assert!(mono.iter().any(|s| s.abs() > 0.1));
    }
}
