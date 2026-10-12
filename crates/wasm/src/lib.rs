//! WebAssembly exports of `gpuviz-core` for the web app (design §5).
//!
//! Values cross the boundary as plain JS objects through
//! `serde-wasm-bindgen`, in the shape of the types ts-rs generates (ADR
//! 0001). `web/src/core/index.ts` casts them to those types.

use serde::Serialize;
use wasm_bindgen::prelude::*;

use gpuviz_core::plan::evaluate as evaluate_plan;
use gpuviz_core::scenario::Scenario;

/// Version of the core crate.
#[wasm_bindgen]
pub fn version() -> String {
    gpuviz_core::version().to_owned()
}

/// The hardware tree of the preset `id` (`HwNode`).
#[wasm_bindgen]
pub fn hardware(id: &str) -> Result<JsValue, JsError> {
    to_js(&gpuviz_core::hardware(id).map_err(js_error)?)
}

/// Every model preset (`ModelConfig[]`).
#[wasm_bindgen]
pub fn models() -> Result<JsValue, JsError> {
    to_js(&gpuviz_core::models().map_err(js_error)?)
}

/// The step plan of `scenario` (a `Scenario`) for the model `model` on the
/// hardware `hw` (`StepPlan`).
#[wasm_bindgen]
pub fn evaluate(hw: &str, model: &str, scenario: JsValue) -> Result<JsValue, JsError> {
    let scenario: Scenario = serde_wasm_bindgen::from_value(scenario)
        .map_err(|e| JsError::new(&format!("invalid scenario: {e}")))?;
    to_js(&evaluate_plan(hw, model, &scenario).map_err(js_error)?)
}

/// Objects instead of `Map`s, `null` for `None`, and numbers for `u64`: the
/// shape `JSON.parse` would give and the generated types describe.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .map_err(|e| JsError::new(&e.to_string()))
}

fn js_error(e: gpuviz_core::error::CoreError) -> JsError {
    JsError::new(&e.to_string())
}
