---
id: warp-scheduler
does: "Picks a [[warp]] that is ready each cycle and sends its next instruction to one of the sub-partition's units."
stores: "Nothing; it tracks the state of the warps assigned to it."
---

Each sub-partition has one warp scheduler. It holds a set of [[warp|warps]], and every cycle it chooses one that is ready to go and issues its next instruction.

## Why it exists

A load from [[hbm]] takes hundreds of cycles to come back. A CPU core hides that wait with big caches and by working ahead. A GPU keeps many warps resident instead, and switching between them costs nothing, so while some wait others compute. The scheduler is what does the switching.

## In a decode step

Most decode kernels are memory-bound: nearly every warp is waiting on a load most of the time. The scheduler keeps finding the few that are ready. The more warps are resident, the more loads are in flight at once, and that is how a kernel gets close to the full bandwidth of [[hbm]].

## Think of it as

A cook with several pots on the stove. While one simmers, they stir another. Nothing is wasted as long as some pot needs attention.
