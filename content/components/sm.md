---
id: sm
does: "The unit that runs thread blocks. It holds the sub-partitions with the math units, the L1 cache and shared memory, and the TMA."
stores: "Registers, [[shared-memory]] and L1 cache: the working set of the [[thread-block|blocks]] it is running."
---

This is where a kernel's math happens. Each [[thread-block]] is placed on an SM, and one SM can run several at a time while they fit in its registers, [[shared-memory]] and warp slots. A kernel with fewer blocks than SMs leaves some of them idle; one with more runs in [[wave|waves]].
