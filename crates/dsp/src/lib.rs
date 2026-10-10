//! Resonance DSP: the analysis pipeline compiled to WebAssembly for the browser and natively
//! for tests and benchmarks.

/// Version of the feature-frame layout. Bump on any change to the frame schema.
pub const FRAME_SCHEMA_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    #[test]
    fn schema_version_is_set() {
        assert_eq!(super::FRAME_SCHEMA_VERSION, 1);
    }
}
