# 0002 — Hardware, model and fusion data as JSON embedded in the core

Status: accepted
Date: 2026-10-09

## Context

The brief says hardware, models and the vLLM fusion profile are data files, not code (D1, D5, D7). The core needs them in native tests and in the browser. The UI also needs the hardware tree, to build the 3D scene. Model files must keep the field names of the official `config.json` (§6.3). Every value carries `confidence` and `sources`, so provenance lives in the data, not in comments.

## Options

- **A — JSON, embedded in the core at compile time** (`include_str!`). The UI gets everything through core functions: `hardware(id)`, `evaluate(hw_id, model_id, scenario)`.
- **B — JSON, fetched by the web app at runtime** and passed into `evaluate(hw, model, scenario)` as values.
- **C — TOML, embedded:** nicer to hand-edit, but `config.json` would have to be translated.

## Decision

**A.** One copy of the data reaches both native tests and the browser, with no loading or versioning path to keep in sync. JSON keeps model files byte-comparable with the upstream `config.json`. The files are a few KB, so the extra WASM size does not matter.

## Consequences

- `data/hardware/*.json`, `data/models/*.json` and `data/fusion/*.json`, validated by serde on load. A test parses every file.
- Changing data requires rebuilding the WASM; there is no hot-swap of hardware from the UI. That is acceptable: v1 and v1.1 ship fixed presets.
- If user-supplied hardware is ever wanted, this ADR gets superseded by B; the core API would only gain a by-value variant of `evaluate`.
