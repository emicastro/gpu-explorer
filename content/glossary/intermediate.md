---
id: intermediate
name: "Intermediate"
short: "A tensor produced by one operation and consumed by another inside the same fused kernel, so it never goes through HBM."
related: ["kernel-fusion", "persistent-tensor"]
sources: ["docs/adr/0012-fused-kernel-bytes-from-op-dataflow.md"]
---

A tensor only counts as an intermediate if no operation of another kernel reads it. If some other kernel does, it must be written out, and it is traffic like any other.
