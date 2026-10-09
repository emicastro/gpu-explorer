# 0006 — Repo layout and JS toolchain: crates/ + web/ with pnpm, Vite, Vitest, Playwright

Status: accepted
Date: 2026-10-09

## Context

The repo holds a Cargo workspace (`core`, `wasm`), a static web app (React + R3F), data files, prose content and profiling tools. Node 22, npm 10 and pnpm 10 are installed. The UI needs unit tests, for store logic and parsers, and a few browser-level checks: navigation, tooltips, no console errors, draw-call budget. A task's `Check:` must be a command.

## Options

- **A — pnpm,** single web package under `web/`, Vite + Vitest + Playwright (Chromium only).
- **B — npm,** same layout and tools.

## Decision

**A — pnpm.** It is installed. Its strict `node_modules` catches undeclared imports, which matters with the large R3F/drei dependency surface, and its lockfile is deterministic. The rest of the toolchain is the default for Vite + React and not a real fork: Vitest shares Vite's config, and Playwright is the only maintained option that drives WebGL in headless Chromium.

## Consequences

- Layout: `crates/core`, `crates/wasm`, `web/`, `data/`, `content/`, `scripts/`, `tools/`, `docs/`.
- `scripts/verify.sh` runs the whole verify: Rust fmt, clippy and tests; the generated-types drift check; the WASM build; web typecheck, lint, unit tests and build; and the e2e suite.
- Playwright downloads Chromium (~150 MB) once. The e2e suite uses Chromium's SwiftShader software GL, so frame-time numbers from it are not meaningful. Performance checks use draw calls and instance counts, not FPS.
