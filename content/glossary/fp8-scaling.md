---
id: fp8-scaling
name: "FP8 scaling: per tensor and per block"
short: "Two ways to scale FP8 values: one scale for the whole tensor, or one scale per block of values."
related: ["w8a8"]
sources: ["Micikevicius et al., FP8 Formats for Deep Learning, arXiv:2209.05433"]
---

FP8 has a narrow range, so values are stored with a scale factor. Per tensor uses one scale for the whole tensor. Per block uses a scale for each block of values: square blocks for the weights and thin rows for the activations. Per block is more accurate and is what the official `Qwen3-8B-FP8` checkpoint uses and what this site shows by default.
