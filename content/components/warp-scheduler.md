---
id: warp-scheduler
does: "Picks a ready warp each cycle and issues its next instruction to one of the sub-partition's units."
stores: "Nothing; it tracks the state of the warps assigned to it."
---

When a [[warp]] waits for a memory load, the scheduler issues another. Memory-bound kernels live on this: with enough resident warps the waiting is hidden.
