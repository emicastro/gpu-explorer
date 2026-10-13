---
id: tensor-core
name: "Tensor core"
short: "A unit that multiplies small matrices in one operation and accumulates the result. It is where matrix multiplications get their throughput."
related: ["cuda-core", "sm", "w8a8"]
sources: ["NVIDIA H100 Tensor Core GPU Architecture whitepaper"]
---

Each [[sm]] has tensor cores in its sub-partitions. Their peak depends on the precision: FP8 runs faster than BF16. Elementwise kernels do not use them.
