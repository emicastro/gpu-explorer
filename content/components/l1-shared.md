---
id: l1-shared
does: "The SM's on-chip memory, split between a hardware-managed L1 cache and program-managed shared memory."
stores: "The [[tile]] being worked on, the values the [[thread-block|blocks]] on this SM share, and recently used global memory."
---

A matrix-multiplication kernel stages the tiles of weights and activations here before the [[tensor-core|tensor cores]] read them. How much a block asks for limits how many blocks run on the [[sm]] at once. See [[shared-memory]].
