---
id: kernel-fusion
name: "Kernel fusion"
short: "Merging several logical operations into one kernel so the data between them does not travel to HBM and back."
related: ["intermediate", "persistent-tensor", "torch-compile", "kernel"]
sources: ["docs/adr/0012-fused-kernel-bytes-from-op-dataflow.md"]
---

A fused kernel counts only the bytes that cross its boundary. The difference from the sum of its operations is the fusion saving the UI shows. What stays inside is an [[intermediate]]; what must survive the step is a [[persistent-tensor]].
