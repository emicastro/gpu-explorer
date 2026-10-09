# 0009 — Quantities in data files: SI base units, same shape as the output

Status: accepted
Date: 2026-10-09

## Context

Design §3.2 gives data files a `QuantityIn { value, unit, confidence, sources }`. The serialized output `Quantity` (task 2.1) has the same fields and uses SI base units only (`B`, `B/s`, `FLOP/s`, …); scaling to GiB or TB/s is the UI's job (`<Q>`, design §6.9). Sources quote numbers in mixed units: "50 MB" of L2 (binary), "3.35 TB/s" (decimal), "80 GB" of HBM (5 × 16 GiB stacks).

## Options

- **A — base units in the data, one type:** values written as `52428800` with unit `"B"`; `Quantity` derives `Deserialize` and serves as both input and output.
- **B — display units in the data, separate `QuantityIn`:** values written as `50` with unit `"MiB"`; the loader converts into base units and builds `Quantity`.

## Decision

**A.** The binary-versus-decimal reading of "MB" is decided once, by whoever writes the value, and recorded in its source string, not hidden in a conversion table. One type means the hardware tree crosses into TS unchanged. The cost is less readable numbers in the JSON, which the source strings offset.

## Consequences

- `Quantity` derives `Deserialize` with `deny_unknown_fields`; a loaded value keeps its sources in file order.
- A source string states the reading when the source is ambiguous, e.g. "80 GB = 5 × 16 GiB HBM3 stacks".
- Typed access checks the unit: asking for `BytesPerSec` from a `"B"` value is an error, not a silent reinterpretation.
- If hand-edited presets ever multiply, B can be added on top as an input-only convenience without changing the output type.
