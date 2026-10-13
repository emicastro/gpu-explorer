---
id: die
does: "The GPU chip itself: the [[sm|SMs]] that do the math, the [[l2-cache|L2 cache]], the memory controllers, and the on-chip network that joins them."
stores: "Its [[l2-cache]] and, inside each SM, registers and [[shared-memory]]. It has no bulk storage: the model lives in [[hbm]]."
---

The die is the slice of silicon where all computing happens. Most of its area is the grid of [[sm|SMs]], grouped into [[gpc|GPCs]]. The [[l2-cache]] runs through the middle, and the memory controllers line the edges, facing the [[hbm]] stacks.

## Why it exists

Doing the math right next to small, fast memories is what makes a GPU fast. Keeping the bulk memory off the die is what makes it affordable: the die holds the compute and the caches, and the [[hbm]] holds the data.

## In a decode step

A decode step is a sequence of [[kernel|kernels]] per layer: a norm, the QKV projection, attention, the output projection, another norm and the MLP. Each kernel spreads its [[thread-block|blocks]] over the SMs. Their loads go through the [[l2-cache]] to [[hbm]]. How many SMs get work depends on how many blocks the kernel launches.

## Think of it as

A large kitchen. The SMs are the cooking stations, the L2 is the pantry they all share, and the memory controllers are the doors to the storeroom next door, the HBM.
