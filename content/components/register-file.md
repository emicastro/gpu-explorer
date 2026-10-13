---
id: register-file
does: "The fastest storage on the chip: the registers of the threads running on the sub-partition."
stores: "Every thread's live values: for a matrix multiplication, mostly the accumulator tile."
---

How many registers a kernel's threads need decides how many [[warp|warps]] fit on an [[sm]]. Matrix-multiplication kernels hold the partial results of their [[tile]] here.
