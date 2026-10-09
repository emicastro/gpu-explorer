//! WebAssembly exports of `gpuviz-core` for the web app (design §5).

use wasm_bindgen::prelude::*;

/// Version of the core crate.
#[wasm_bindgen]
pub fn version() -> String {
    gpuviz_core::version().to_owned()
}
