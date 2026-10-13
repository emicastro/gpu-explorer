---
id: tpc
name: "Texture processing cluster (TPC)"
short: "A pair of SMs that share some resources. TPCs make up a GPC."
related: ["sm", "gpc"]
sources: ["NVIDIA H100 Tensor Core GPU Architecture whitepaper"]
---

Fusing off happens in units of whole TPCs, which is why the number of enabled [[sm|SMs]] comes in pairs.
