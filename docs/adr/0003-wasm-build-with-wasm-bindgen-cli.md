# 0003 — WASM build with cargo + pinned wasm-bindgen-cli

Status: accepted
Date: 2026-10-09

## Context

The `wasm` crate must be compiled to `wasm32-unknown-unknown` and post-processed by wasm-bindgen into an ES module that Vite can import. Neither `wasm-pack` nor `wasm-bindgen-cli` is installed on the dev machine. The CLI's version must match the `wasm-bindgen` crate's version exactly.

## Options

- **A — wasm-pack:** `wasm-pack build --target web`; one tool that wraps cargo, wasm-bindgen and wasm-opt.
- **B — cargo + wasm-bindgen-cli:** a script runs `cargo build --target wasm32-unknown-unknown --release` and then `wasm-bindgen --target web`. The crate is pinned with `=X.Y.Z`, and the CLI is installed with `--version X.Y.Z --locked`.

## Decision

**B.** It has one fewer layer between us and the toolchain, and the version pin is explicit in `Cargo.toml` and in the script. wasm-pack moved out of the rustwasm org after that org was sunset in 2025, and we gain nothing from its packaging features: we do not publish to npm.

## Consequences

- `scripts/build-wasm.sh` is the only entry point. It checks that the CLI version equals the crate pin and fails with the install command if not.
- The output goes to `web/src/wasm/` (git-ignored). Vite imports it as an ES module; Vitest loads it with `initSync` from the `.wasm` bytes on disk.
- No `wasm-opt` pass in v1. Add one if the binary passes ~1 MB.
