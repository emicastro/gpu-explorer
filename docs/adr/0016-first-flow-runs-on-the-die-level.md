# 0016 — The first data-flow animation runs on the die level

Status: accepted
Date: 2026-10-12

## Context

Task 4.4 animates one kernel (the QKV GEMM) along HBM → L2 → SM → tensor core. The scene draws two levels so far (task 4.3):

- **Package:** the HBM sites and the die as a single box.
- **Die:** the memory controllers, the L2 halves and the GPCs. The HBM is not on it.

The SM and the tensor core have no geometry until task 5.1, which lays out the GPC, the SM and the sub-partition. The plan carries only HBM bytes per kernel (`bytes.hbmRead`, `phaseBreakdown`), not bytes per memory level.

## Options

- **A — die level:** particles leave the active memory controllers (the HBM's door into the die), cross the L2 half on their side and drop into a GPC. The SM → tensor core leg is that drop, with no geometry until 5.1.
- **B — package and die:** the HBM → die leg on the package level, the rest on the die level. The animation is split across a camera flight.
- **C — stub SM and tensor core now:** minimal SM and tensor-core boxes inside one GPC in 4.4, which 5.1 then replaces.

## Decision

**A.** All four stops fit in one view, which matches the milestone's two levels (brief §9) and needs no throwaway geometry. The user chose it at the start of task 4.4.

## Consequences

- Every leg is labeled with HBM bytes. That holds for a GEMM at M = 1, where each weight goes to one CTA. It understates L2 → SM once M is large enough for L2 reuse; showing that needs per-level bytes in the core.
- Every GPC gets particles until task 5.3 narrows the flow to the SMs the wave occupies.
- Routes are `simplified`: each controller feeds the L2 half on its side, and any GPC reads from either half.
- When 5.1 adds the SM and sub-partition levels, the last two legs can continue there. The die-level routes stay as the overview.
