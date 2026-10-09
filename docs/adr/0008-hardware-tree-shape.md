# 0008 — Hardware tree: repeated nodes, uneven GPCs and counts with provenance

Status: accepted
Date: 2026-10-09

## Context

`data/hardware/h100-sxm.json` is a tree of `HwNode` (brief §6.2) with `count` and `enabled` per node. Most hardware repeats uniformly (2 SMs per TPC, 4 sub-partitions per SM). GPCs do not: 66 enabled TPCs over 8 GPCs of 9 cannot be uniform. Design §3.2 fixes the split at 6 GPCs with 8 enabled TPCs and 2 with 9, marked `simplified`. The brief also says confidence is per value, not per node (§5, R6), and some counts are documented while others (the GPC split, the two L2 halves) are approximations.

## Options

- **A — one node per physical GPC:** eight `gpc` nodes, each with its own TPC/SM subtree. Literal, but repeats the SM subtree eight times.
- **B — one node per distinct variant, multiplied by `count`:** two GPC nodes (`gpc-8tpc` ×6, `gpc-9tpc` ×2) that share `contentId: "gpc"`. Uniform repetition stays a single node.
- **C — B with plain-number counts:** like B, but `count` and `enabled` are bare numbers with no confidence.

## Decision

**B**, with `count` and `enabled` as `Quantity` values (unit `count`), both optional: a missing `count` means 1 and a missing `enabled` means all of them. B keeps the file small and reviewable, and the 3D layout places `count` instances either way. Counts carry provenance because the GPC split and the L2 halves are exactly the numbers the UI must flag as `simplified`; C would hide that.

## Consequences

- Totals are products along the path: SMs enabled = Σ over SM nodes of the product of `enabled` from the root. The core exposes this; a test checks 8 GPCs, 66 TPCs, 132 SMs and 10 memory controllers.
- Which physical GPC, TPC or HBM site is disabled is not in the data; the layout (task 4.3) chooses it and marks it `simplified`.
- Node ids are unique across the tree; `contentId` ties variants to one prose entry.
- A per-unit floorplan (a real map of which SMs are fused off) would need A. Nothing in v1 needs it.
