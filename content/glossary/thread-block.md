---
id: thread-block
name: "Thread block (CTA)"
short: "The group of threads that a kernel launches as one unit. A block runs on a single SM and its threads can share memory."
related: ["warp", "sm", "shared-memory", "tile"]
sources: []
---

The kernel's grid is the set of all its blocks. The hardware assigns blocks to [[sm|SMs]] as resources free up. Each block computes one [[tile]] in a matrix multiplication.
