---
id: cuda-core
does: "The scalar FP32 lanes: each does one floating-point multiply-add per cycle, for elementwise work like norms, activations and residual adds."
stores: "Nothing; operands are in registers."
---

CUDA cores are the GPU's general-purpose arithmetic lanes. A [[warp]]'s instruction runs on them with each thread working on its own number.

## Why it exists

Not everything in a model is a matrix multiplication. Norms, activation functions, softmax and adds need ordinary arithmetic on single numbers, and these lanes do it, with any formula a program can write.

## In a decode step

[[rmsnorm|RMSNorm]], the SiLU of the MLP, the residual add and the softmax arithmetic of attention run here, as does sampling the next token. They take few FLOPs but have to stream the whole tensor through, so they are memory-bound. Fusing them into a neighbouring kernel saves those trips ([[kernel-fusion]]). During a weight multiplication these lanes are mostly idle, because the [[tensor-core|tensor cores]] do the math.

## Think of it as

The cooks with knives: many of them, each doing one item at a time, all in step.
