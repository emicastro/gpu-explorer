# 0015 — The step plan crosses the WASM boundary as JSON-shaped objects, with its numbers as `Quantity`

Status: accepted
Date: 2026-10-12

## Context

Task 3.6 adds the WASM exports `hardware`, `models` and `evaluate`. Their values cross through `serde-wasm-bindgen`, and the web casts them to the types ts-rs generates (ADR 0001). Three choices follow, and all three shape the wire format.

- **Serializer.** The default `serde-wasm-bindgen` serializer turns maps into JS `Map`s, `None` into `undefined` and `u64` into numbers. ts-rs describes maps as plain objects, `Option` as `T | null` and `u64` as `bigint`. Both sides have to agree.
- **Grid numbers.** Brief §6.6 drafts `grid.blocks`, `waves`, `waveEfficiency` and `splits` as plain numbers. R16 makes every number the UI shows carry its confidence, and design §6.9 enforces that with a lint rule that bans rendering a `number`. Each `Launch` has a provenance: FA3's grid is `documented`, Inductor's is `simplified`.
- **Model presets.** `ModelConfig` holds `quantization_variants`. Their `ScaleGranularity` is an internally tagged enum with `deny_unknown_fields`, which ts-rs 12 cannot parse on an enum and warns about on every build. The UI picks one of four weight formats and never reads a scheme.

## Options

- **A — JSON-shaped and quantities:** `Serializer::json_compatible()` (objects, `null`, numbers) with `TS_RS_LARGE_INT = "number"`; grid counts as `Quantity` with the launch's provenance, `tile` and `perWave` as plain numbers; `models()` serializes without `quantization_variants`.
- **B — default serializer and the brief's shape:** `Map`s and `bigint` on the TS side, with hand-written adapters; grid counts as plain numbers, and the UI wraps them in a confidence it has to look up.
- **C — JSON string across the boundary:** `serde_json::to_string` in Rust and `JSON.parse` in TS. One extra copy and parse on every knob change.

## Decision

**A.** The generated types then describe exactly what arrives, so the cast in `web/src/core/index.ts` is honest and needs no adapter. The provenance of a grid count already exists in the core, so the plan carries it (R6, R16). Every `u64` the core emits stays far below 2^53. `tile` and `perWave` are shapes that the 3D mapping consumes, not values the UI shows on their own.

## Consequences

- A new `u64` field must stay below 2^53, or it silently loses precision on the JS side.
- `ModelConfig` serialized from the core is not the data file: it lacks `quantization_variants`. If the UI ever shows a scheme, it gets an exported type that ts-rs can parse.
- `grid` mixes `Quantity` fields with plain-number shapes. A view that renders a tile size has to label it through `<Q>` with the grid's confidence, or the lint rule stops it.
