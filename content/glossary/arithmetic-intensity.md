---
id: arithmetic-intensity
name: "Arithmetic intensity"
short: "FLOPs per byte moved from memory. Below the ridge point a kernel is memory-bound; above it, compute-bound."
related: ["roofline", "ridge-point"]
sources: []
---

It is a property of the kernel and its shapes, not of the hardware. Decode matrix multiplications have few FLOPs per weight byte, so they sit far to the left on the [[roofline]].
