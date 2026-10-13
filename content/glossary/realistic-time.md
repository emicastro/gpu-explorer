---
id: realistic-time
name: "Realistic time"
short: "The lower bound corrected with per-kernel efficiency and overhead factors calibrated against public benchmarks. Always shown as estimated."
related: ["lower-bound", "kernel"]
sources: []
---

The realistic time takes the [[lower-bound]] and adds what real kernels lose: the share of peak bandwidth and compute that code actually reaches, and the fixed cost of launching. The factors come from public benchmarks, so the result is always marked `estimated`.
