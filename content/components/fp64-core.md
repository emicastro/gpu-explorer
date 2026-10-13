---
id: fp64-core
does: "The double-precision lanes. Scientific computing uses them; LLM inference does not."
stores: "Nothing; operands are in registers."
---

The model does not use these at all: weights and activations are in FP8, BF16 or FP32. They are on the chip for other workloads.
