# 0010 — Model files: verbatim upstream config with file-level provenance

Status: accepted
Date: 2026-10-09

## Context

ADR 0002 keeps model files byte-comparable with the official `config.json` (brief §6.3). R6 and D10 require every number the core emits to carry a confidence and sources. The hardware tree does this per value, with a `Quantity` for each spec (ADR 0009). An upstream `config.json` has plain numbers (`"hidden_size": 4096`) and no place for provenance. All of its values share one source: the file itself, at one Hugging Face revision. The FP8 quantization variants are not upstream verbatim. `block` comes from the `Qwen3-8B-FP8` checkpoint's `quantization_config`. `per_tensor` comes from vLLM's online quantization code.

## Options

- **A — verbatim `config` object plus one file-level `provenance`:** `{ id, name, provenance, config: <upstream config.json, unchanged>, quantization_variants }`. Every value read from `config` gets `provenance`. Each quantization variant carries its own `confidence` and `sources`.
- **B — every config field as a `Quantity`,** as in the hardware tree. Uniform with ADR 0009, but the file is no longer comparable with upstream, and 26 fields would repeat one source string.
- **C — the upstream `config.json` copied as its own file, with a sidecar file for provenance and variants.** Byte-identical with upstream, but each model is two files that must stay in step.

## Decision

**A.** `config` can be checked against upstream with one `jq` diff. The provenance of the whole object really is one source, so stating it once is accurate, not a shortcut. `deny_unknown_fields` on `config` lists every upstream field, so a new field in a future checkpoint fails to load instead of being silently dropped.

## Consequences

- A value derived from `config` (parameter count, KV bytes per token) starts from the file-level `provenance` and joins it with any other input. A config number alone is `documented`.
- `config` stays in upstream's snake_case. The wrapper keys use snake_case too (`quantization_variants`), unlike the hardware tree's camelCase, so one file has one convention.
- A field we model differently from upstream cannot be edited in place in `config`. It goes in a separate wrapper key with its own provenance.
- Qwen3-30B-A3B (v1.1) follows the same shape. Its `config` struct gets the MoE fields.
