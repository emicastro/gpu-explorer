---
id: lower-bound
name: "Lower bound"
short: "The least time a kernel can possibly take: the larger of its math time at peak FLOP/s and its memory time at peak bandwidth."
related: ["roofline", "realistic-time", "kernel"]
sources: []
---

The lower bound assumes the hardware runs at 100 % of its peak with no overhead: `max(FLOPs / peak, bytes / bandwidth)`. Real kernels are always slower.

Whichever term wins says what limits the kernel: the math ([[arithmetic-intensity|compute-bound]]) or the memory traffic (memory-bound). The [[roofline]] plots exactly this.
