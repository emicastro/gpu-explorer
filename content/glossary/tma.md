---
id: tma
name: "Tensor Memory Accelerator (TMA)"
short: "Hardware that copies whole tiles between global and shared memory without the threads issuing each load."
related: ["shared-memory", "tile", "persistent-kernel"]
sources: ["NVIDIA H100 Tensor Core GPU Architecture whitepaper"]
---

It lets a few threads start a bulk copy while the rest compute, which is what kernels like FA3 and DeepGEMM use to overlap loads with math.
