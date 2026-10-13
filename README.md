# GPU Inference Explorer

An interactive 3D walk through an NVIDIA H100 SXM running one inference step of Qwen3-8B in vLLM v0.31.0. You see which kernels launch, on which SMs, and how many bytes and FLOPs each one moves.

## Who it is for

It is for engineers who know how a transformer works but not what happens in the silicon when it runs. Some tools visualize the model without the hardware, others explain gaming GPUs, and others are 2D roofline calculators. This one connects token → layer → kernel → SM → HBM bytes in one view you can navigate.

It is a static site with no backend. It needs a desktop browser with WebGL and a window at least 1024 px wide. A modern integrated GPU is enough.

## What you can do

- **Navigate the GPU** at five levels: package → die → GPC → SM → sub-partition. Disabled SMs stay visible. Escape or Backspace goes back one level, and breadcrumbs show where you are.
- **Play one step** with play, pause, scrub and speed controls. In *didactic* mode every kernel stays on screen long enough to read. In *real-time* mode durations are proportional to GPU time. One layer plays in detail and the rest are folded.
- **Watch each kernel**: which SMs hold blocks in the current wave (including the split-KV lesson in attention), and bytes flowing HBM → L2 → SM → tensor core, with the exact count shown.
- **Turn the knobs**: batch, context (1 to 131 072 tokens, with a YaRN mark past 32k), weight precision (BF16, block-wise FP8, per-tensor FP8, W8A16), KV precision (BF16, FP8), phase (decode or prefill) and time mode. Every change re-evaluates the whole step.
- **Read the linked views**: a kernel timeline, a log-log roofline with one point per kernel, and an HBM bar with weights, KV cache and the largest batch that fits. Selecting a kernel in one view highlights it in the others and in 3D.
- **Ask any part what it is**: hover a part for its name and definition, click it for a panel with what it does, what it holds and what the model is doing there right now. Glossary terms open nested tooltips, by mouse or by keyboard.

## How far to trust the numbers

Every number the core produces carries a confidence level and its sources. The UI shows the level next to the number, and the sources on hover or focus.

| Level | Meaning |
|---|---|
| `documented` | Taken from a spec, a paper or the source code of the kernel library, with a link. |
| `simplified` | Follows a documented rule, with details left out (e.g. the physical TPC layout). |
| `estimated` | Calibrated or inferred, with the reasoning written down. |

The realistic step time is calibrated against a public anchor: decode of Qwen3-8B in BF16 at batch 1 lands within ±15 % of the measured 7.28 ms. It is not a cycle-level simulator. It does not model fine-grained occupancy or kernel overlap, so read the timings as a model of where time goes, not as a benchmark.

Out of scope for v1: MoE models, GPUs other than the H100 SXM, mixed context lengths within a batch, training, multi-GPU, quantization below FP8, speculative decoding and request scheduling.

## Running it locally

You need:

- [rustup](https://rustup.rs). `rust-toolchain.toml` pins the toolchain and the `wasm32-unknown-unknown` target, so rustup installs both on first use.
- `wasm-bindgen-cli` at the exact version pinned in `crates/wasm/Cargo.toml`:
  `cargo install wasm-bindgen-cli --version 0.2.129 --locked`
- Node 22 or newer and pnpm 10 (`corepack enable` picks the version from `package.json`).

```sh
scripts/build-wasm.sh        # builds the Rust core into web/src/wasm/
cd web
pnpm install
pnpm dev                     # http://localhost:5173
```

The data files under `data/` are embedded in the core at compile time, so run `scripts/build-wasm.sh` again after changing anything under `crates/` or `data/`. Vite reloads changes to `content/` and `web/` on its own.

## Verifying

```sh
cd web && pnpm exec playwright install chromium   # once, for the e2e tests
scripts/verify.sh
```

`verify.sh` runs the full recipe: `cargo fmt --check`, clippy with warnings as errors, `cargo test`, a drift check on the TypeScript types generated from Rust, the WASM build, and in `web/` the typecheck, lint, unit tests, production build and Playwright e2e tests in headless Chromium.

## Repository map

```
crates/core/      gpuviz-core: units, data, ops, fusion profile, roofline, tiling, timing, memory, evaluate
crates/wasm/      gpuviz-wasm: the WASM boundary (hardware, models, evaluate)
data/hardware/    H100 SXM hardware tree and calibration
data/models/      Qwen3-8B config
data/fusion/      vLLM v0.31.0 fusion profile for H100
data/traces/      reference kernel trace
content/          glossary and component prose (Markdown)
web/              Vite + React + react-three-fiber app
scripts/          build-wasm.sh, verify.sh
tools/profiling/  scripts that produced the reference trace
```

The core is pure Rust. `evaluate(hardware, model, scenario)` returns a `StepPlan` with every kernel of the step, and the web app calls it once per knob change. The animation runs in TypeScript on that plan and never crosses the WASM boundary per frame.

## Design documents

The design documents are in Spanish:

- [`docs/requirements.md`](docs/requirements.md): the what and why of v1, with acceptance criteria.
- [`docs/design.md`](docs/design.md): how it is built.
- [`docs/tasks.md`](docs/tasks.md): the task list, each with the command that checks it.
- [`docs/adr/`](docs/adr/): architecture decision records (these are in English).
- [`docs/brief.md`](docs/brief.md): the original research brief, with the formulas and sources.
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md): the project vocabulary.
- [`docs/profiling.md`](docs/profiling.md): how to reproduce the reference trace.
- [`docs/perf.md`](docs/perf.md): frame-rate measurements.

## License

- Source code: [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
- Content (prose and glossary under `content/`, and the procedural 3D geometry): [CC BY 4.0](LICENSE-CONTENT).

## Not affiliated with NVIDIA

This is an independent educational project. It is not affiliated with, sponsored by or endorsed by NVIDIA. All geometry is procedural and drawn from public specifications. The repository contains no NVIDIA images or 3D models. NVIDIA and H100 are trademarks of NVIDIA Corporation.
