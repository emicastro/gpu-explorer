---
id: hbm
name: "High Bandwidth Memory (HBM)"
short: "The GPU's main memory. Weights and the KV cache live here."
related: ["kv-cache", "package", "l2-cache"]
sources: []
---

HBM is stacked DRAM beside the die. It has far more capacity than the on-chip caches and far less bandwidth than they have, so most of the time in [[decode]] is spent reading from it.
