---
id: swapab
name: "swapAB"
short: "A GEMM trick for a small M: swap the operands so that the weight rows fill the tile's large dimension and the tokens fill the small one."
related: ["tile", "tensor-core", "w8a8"]
sources: []
---

Tensor-core tiles have a minimum size along the token dimension. With few tokens, most of a tile would be padding. Swapping the operands puts the many weight rows where the tile is wide and the few tokens where it is narrow, so less of the tile is wasted. FlashInfer uses it for block-scaled FP8 when there are few tokens.
