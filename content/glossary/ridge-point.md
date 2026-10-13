---
id: ridge-point
name: "Ridge point"
short: "The GPU's peak FLOP/s divided by its memory bandwidth: the intensity at which the bottleneck changes."
related: ["roofline", "arithmetic-intensity"]
sources: []
---

It depends on the precision, because the compute peak does: FP8 has a higher ridge point than BF16. A kernel whose [[arithmetic-intensity]] is below it is memory-bound.
