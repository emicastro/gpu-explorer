---
id: fp64-core
does: "The double-precision lanes. Scientific computing uses them; LLM inference does not."
stores: "Nothing; operands are in registers."
---

These lanes do arithmetic on 64-bit floating-point numbers, which are far more precise than a model needs.

## Why it exists

The H100 is also sold for simulation and scientific computing, where double precision matters. These lanes are there for that work.

## In a decode step

Nothing. The weights and activations are FP8, BF16 or FP32, so a decode step never uses these lanes.
