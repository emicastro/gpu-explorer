---
id: cuda-core
does: "The scalar FP32 lanes. They do the elementwise work: activations, scaling, residual adds."
stores: "Nothing; operands are in registers."
---

Norms, the residual add and the activation function run here, as does the softmax arithmetic of attention. They are cheap in FLOPs but need the whole tensor to stream through, so they are usually memory-bound. A kernel built on [[tensor-core]] math leaves them mostly idle.
