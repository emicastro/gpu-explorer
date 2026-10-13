---
id: kernel
name: "Kernel"
short: "A function that runs on the GPU, launched by the host. A logical operation of the model can be one kernel or part of a fused one."
related: ["kernel-fusion", "thread-block", "lower-bound"]
sources: []
---

A kernel runs as a grid of [[thread-block|thread blocks]] spread over the [[sm|SMs]]. Here the word never means the operating-system kernel.
