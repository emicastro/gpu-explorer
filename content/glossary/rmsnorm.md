---
id: rmsnorm
name: "RMSNorm"
short: "Normalization that divides each activation vector by its root mean square and scales it with a learned weight."
related: ["residual-stream"]
sources: ["Zhang and Sennrich, Root Mean Square Layer Normalization, arXiv:1910.07467"]
---

Qwen3 applies it before attention, before the MLP, at the end of the model, and to Q and K (QK-norm). It is not LayerNorm: it does not subtract the mean. It is a cheap, memory-bound operation, which is why it is usually [[kernel-fusion|fused]] with a neighbour.
