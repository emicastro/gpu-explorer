# 0011 — Fusion profile: structured conditions and relative op references

Status: accepted
Date: 2026-10-09

## Context

Design §4.1 makes the vLLM fusion profile data: an ordered list of kernel templates per layer, each with `name`, `ops`, `impl` and `when`. Three things are left open, and the code can't be written until they're settled:

- **How `when` is written.** The conditions found in vLLM v0.31.0 are few and flat. They are the weight format, the phase, the number of tokens `M` (FlashInfer swapAB for `M < 32`, DeepGEMM for `M ≥ 32`), the attention split count seen by FA3's host code (the `combine` kernel runs only when it is above 1), and whether this is the first layer (embedding lookup instead of the residual add).
- **How a template names ops in another layer.** The kernel that starts layer *i* fuses the residual add that closes layer *i−1* with layer *i*'s input RMSNorm (brief §6.5). The final RMSNorm kernel fuses the last layer's residual. Each logical op belongs to exactly one layer, so the template needs a way to reach back one layer.
- **Provenance.** R6 needs a confidence and sources for every number. Templates differ in confidence. The BF16 sequence is `documented` from the RTX 3070 trace and the source. The FP8 block quant kernels are `documented` from source. The per-tensor FP8 fusions are `simplified`, inferred from Inductor's behavior, with no trace. The input-preparation kernels are `estimated`.

## Options

- **A — structured JSON:** `when` is an object whose keys are all optional and must all hold (`{"weights": ["fp8_block"], "tokens": {"lt": 32}}`). An op is written `"kind"` for the current layer or `"kind@prev"` for the previous one. Each template carries `confidence` plus `sources`, given as keys into a file-level `sources` map.
- **B — expression strings:** `"when": "weights == fp8_block && tokens < 32"`, parsed by a small expression parser in the core. Ops and provenance are the same as in A.
- **C — one explicit kernel list per variant:** no `when`; the file lists the full layer for each (phase, weights, M branch, split) combination, about 12 lists. The core picks one.

## Decision

**A.** The conditions are a conjunction of five facts. A struct with `deny_unknown_fields` checks them at load time without writing a parser, and a typo fails to load instead of evaluating to false. C repeats about ten identical templates per list, so a fix to one kernel has to be made in every list. Expression strings (B) can say more than A, but nothing in v0.31.0 needs it.

## Consequences

- A new kind of condition (for example, KV dtype once FP8 KV changes a kernel) is a new optional field in `When` and a code change, not just a data edit. That is acceptable: the core has to compute the fact anyway.
- Disjunction is written as separate templates, or as a list of values on one key (`"weights": ["bf16", "fp8_block"]`). Templates for the same slot must have disjoint conditions. `fuse` rejects a step where an op runs in two kernels or in none, and a test runs it over every scenario variant.
- `@prev` in the per-layer list is valid only in templates gated on `"firstLayer": false`. In the epilogue it means the last layer. The prologue cannot reference layer ops. The loader enforces all three.
- Source strings are written once and shared. The loader rejects unknown keys, unused keys, and templates without a source.
- Keys are camelCase, as in the hardware tree (ADR 0008). Enum values stay snake_case (`fp8_block`, `inductor_elementwise`), as in design §4.1.
