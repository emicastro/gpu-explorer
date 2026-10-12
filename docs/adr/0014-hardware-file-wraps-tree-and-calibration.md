# 0014 — The hardware file wraps the tree and a sibling `calibration` block

Status: accepted
Date: 2026-10-10

## Context

Task 3.5 adds a `calibration` block to `data/hardware/h100-sxm.json`: `η_m`, the `η_c` curve, the SMs needed to saturate HBM, and `t_overhead` with and without CUDA graphs (design §4.4). Today the file's root is the `HwNode` tree itself (ADR 0008), parsed with `deny_unknown_fields`, and `hardware(id)` returns that root. Calibration is not a component of the tree. It describes how the software stack (vLLM, cuBLAS, CUDA graphs) runs on this GPU. It also has shapes the tree's `specs: Record<string, Quantity>` cannot hold: a curve is a list of points.

The efficiencies are dimensionless, and `Quantity` requires a unit tag (ADR 0009). The units today have no dimensionless entry.

## Options

- **A — wrap the file:** `{ "tree": HwNode, "calibration": Calibration }`. `hardware(id)` keeps returning the tree; a new `calibration(id)` returns the block.
- **B — optional field on the root node:** `HwNode` gains `calibration?: Calibration`, and the validator rejects it on any node but the root.
- **C — specs on the tree:** `η_m` and the saturation count as specs of `package`, the overheads as specs of `board`, and the curve flattened into numbered specs (`computeEfficiency0Flops`, …).

## Decision

**A.** It keeps the recursive `HwNode` type (and its generated TS type) free of a field that means nothing on every node but the root, and the curve stays a typed list. B mixes stack behavior into the component type. C would split one curve over keys that only a naming convention ties together.

## Consequences

- Every caller of `hardware(id)` keeps working. Only the loader learns the wrapper.
- Units gain `Ratio`, serialized as `"1"` (the SI unit of a dimensionless quantity), so efficiencies are `Quantity` values with confidence and sources like everything else (R6).
- The WASM `hardware()` export (task 3.6) returns the tree only. Calibration reaches the UI through the realistic times and their provenance in the `StepPlan`. If the UI ever needs to show the raw block, it gets its own export.
- A second hardware preset (H200, v1.1) brings its own calibration in the same file.
