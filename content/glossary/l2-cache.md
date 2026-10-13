---
id: l2-cache
name: "L2 cache"
short: "The on-chip cache shared by all SMs, between them and HBM."
related: ["hbm", "sm"]
sources: []
---

Every read from [[hbm]] passes through it. Data one block loads can be served to another from here, so reuse across [[sm|SMs]] costs less than a second trip to memory.
