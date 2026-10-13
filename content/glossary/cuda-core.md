---
id: cuda-core
name: "CUDA core"
short: "A scalar floating-point lane. Elementwise operations, reductions and the glue around matrix multiplications run on them."
related: ["tensor-core", "warp"]
sources: []
---

They are much slower than the [[tensor-core|tensor cores]] at matrix math, which is why a kernel built on tensor-core instructions leaves them mostly idle.
