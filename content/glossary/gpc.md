---
id: gpc
name: "Graphics processing cluster (GPC)"
short: "A group of TPCs that share resources. The enabled SMs are not spread evenly across GPCs."
related: ["tpc", "sm", "die"]
sources: ["NVIDIA H100 Tensor Core GPU Architecture whitepaper"]
---

Chips are sold with part of their units fused off, so some GPCs have fewer enabled [[tpc|TPCs]] than others. This site's split of the enabled TPCs over GPCs is a simplification and is marked as such.
