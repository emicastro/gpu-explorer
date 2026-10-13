---
id: warp
name: "Warp"
short: "A group of threads that execute together, one instruction at a time. The unit the warp schedulers issue."
related: ["thread-block", "sm"]
sources: []
---

A [[thread-block]] is made of warps. When one warp waits for memory, the scheduler issues another, which is how an [[sm]] hides latency.
