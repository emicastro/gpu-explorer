---
id: ld-st
does: "The load/store units: they carry out the warps' memory instructions, to [[shared-memory]] and, through the L1, to global memory."
stores: "Nothing; they move data between registers and memory."
---

When a thread reads or writes memory, the instruction goes to a load/store unit. It works out which bytes the threads of the [[warp]] want, groups them into as few memory requests as it can, and sends them on.

## Why it exists

The math units only see registers. Something has to move data between registers and the memories around them, and do it for a whole warp at once. Gathering a warp's neighbouring addresses into one request is what keeps memory traffic efficient.

## In a decode step

Every byte a decode kernel reads from or writes to [[hbm]] passes through them, unless the [[tma]] moves it instead. That includes the [[kv-cache]] that attention reads and the activations of the norm and activation kernels.

## Think of it as

The runners between the counter and the cooks' hands. They carry whatever was asked for, and a good runner brings a whole tray in one trip instead of one item each time.
