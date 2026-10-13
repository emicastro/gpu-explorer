---
id: hbm-stack
does: "One stack of High Bandwidth Memory: DRAM dies stacked beside the GPU die and joined to it by the interposer."
stores: "The model weights, the [[kv-cache]], and the activations that do not fit on chip. Capacity is the sum over all stacks."
---

Everything the LLM needs between steps lives here. In [[decode]] each step reads the weights and the whole [[kv-cache]] from [[hbm]], so the kernel time is mostly this stack's bandwidth.
