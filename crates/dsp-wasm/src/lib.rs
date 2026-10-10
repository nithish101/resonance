//! JavaScript bindings. Kept thin: all logic lives in `resonance-dsp`.
//!
//! The DSP worker writes each hop straight into WASM memory through `inputPtr` and reads the
//! frame from `framePtr`, so no samples or frames cross the boundary through wasm-bindgen glue.
//! The analyzer never allocates after construction, so those pointers (and JS views of them)
//! stay valid for its lifetime.

use resonance_dsp::frame::{FRAME_FLOATS, OFFSETS};
use resonance_dsp::{Analyzer as Inner, Config};
use wasm_bindgen::prelude::*;

/// Feature-frame schema version, so the JS side can refuse a mismatched build.
#[wasm_bindgen(js_name = schemaVersion)]
pub fn schema_version() -> u32 {
    resonance_dsp::FRAME_SCHEMA_VERSION
}

/// Field offsets in the order of the `F` table in frames.ts (checked by a Vitest test).
#[wasm_bindgen(js_name = frameOffsets)]
pub fn frame_offsets() -> Vec<u32> {
    OFFSETS.iter().map(|&o| o as u32).collect()
}

#[wasm_bindgen(js_name = frameFloats)]
pub fn frame_floats() -> u32 {
    FRAME_FLOATS as u32
}

#[wasm_bindgen]
pub struct Analyzer {
    inner: Inner,
}

#[wasm_bindgen]
impl Analyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, frame_size: usize, hop: usize) -> Result<Analyzer, JsError> {
        if !frame_size.is_power_of_two() || frame_size < 64 {
            return Err(JsError::new("frame size must be a power of two >= 64"));
        }
        if hop == 0 || hop > frame_size {
            return Err(JsError::new("hop must be in 1..=frameSize"));
        }
        let mut cfg = Config::new(sample_rate);
        cfg.frame_size = frame_size;
        cfg.hop = hop;
        Ok(Self {
            inner: Inner::new(cfg),
        })
    }

    #[wasm_bindgen(js_name = inputPtr)]
    pub fn input_ptr(&mut self) -> *mut f32 {
        self.inner.input_mut().as_mut_ptr()
    }

    #[wasm_bindgen(js_name = framePtr)]
    pub fn frame_ptr(&self) -> *const f32 {
        self.inner.frame().as_ptr()
    }

    pub fn process(&mut self) {
        self.inner.process();
    }

    #[wasm_bindgen(js_name = setParams)]
    pub fn set_params(&mut self, sensitivity: f32, smoothing: f32) {
        self.inner.set_params(sensitivity, smoothing);
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}
