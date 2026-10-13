---
id: tma
does: "Copies whole tiles between global memory and shared memory on its own, so the threads don't issue each load."
stores: "Nothing; it moves data in flight."
---

Kernels such as FA3 and DeepGEMM start a bulk copy of the next [[tile]] and compute on the current one while it arrives. This is how they overlap [[hbm]] traffic with math. See [[tma]].
