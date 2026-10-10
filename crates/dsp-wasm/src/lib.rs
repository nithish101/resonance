//! JavaScript bindings. Kept thin: all logic lives in `resonance-dsp`.

use wasm_bindgen::prelude::*;

/// Feature-frame schema version, so the JS side can refuse a mismatched build.
#[wasm_bindgen(js_name = schemaVersion)]
pub fn schema_version() -> u32 {
    resonance_dsp::FRAME_SCHEMA_VERSION
}
