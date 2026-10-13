---
id: ld-st
does: "The load/store units: they issue the memory instructions of the warps to shared memory and, through the L1, to global memory."
stores: "Nothing; they move data between registers and memory."
---

Every byte a kernel reads from or writes to [[hbm]] goes through them, unless the [[tma]] moves it instead.
