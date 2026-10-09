# 0001 — Rust → TypeScript types with ts-rs

Status: accepted
Date: 2026-10-09

## Context

The core (Rust) is the single source of truth for every type that crosses into the UI: `Quantity`, `Scenario`, `StepPlan`, the hardware tree (brief D5, §6). The brief requires `core` to stay free of WASM dependencies, with a thin `wasm` crate for bindings. The TS types must be generated, not hand-copied, and drift between Rust and TS must fail a check.

## Options

- **A — tsify:** `#[derive(Tsify)]` emits the types into the `.d.ts` that wasm-bindgen generates; values cross with serde-wasm-bindgen.
- **B — ts-rs:** `#[derive(TS)]` exports `.ts` files from a `cargo test` run; it has no WASM dependency, and values cross with serde-wasm-bindgen.

## Decision

**B — ts-rs.** tsify pulls `wasm-bindgen` into whatever crate derives it. That means either `core` takes a WASM dependency, against D5, or the `wasm` crate re-declares every type, which is the duplication we want to avoid. ts-rs derives sit in `core` behind a `ts` feature and run as an ordinary native test.

## Consequences

- Generated files live in `web/src/generated/` and are committed. The check `cargo test -p gpuviz-core --features ts && git diff --exit-code web/src/generated` catches drift.
- The functions exported by wasm-bindgen return `any` in their `.d.ts`. A hand-written wrapper of a few lines (`web/src/core/index.ts`) casts each one to its generated type, and a round-trip test guards that wrapper.
- Unit newtypes (`Bytes`, `Flops`, …) are serialized as plain numbers inside a `Quantity`. The TS side does not get compile-time units; that guarantee lives in Rust only.
