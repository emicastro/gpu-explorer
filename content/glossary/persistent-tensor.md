---
id: persistent-tensor
name: "Persistent tensor"
short: "A tensor that is always written to HBM however kernels are fused, because it must outlive the step: the KV cache and the sampled tokens."
related: ["kernel-fusion", "intermediate", "kv-cache"]
sources: ["docs/adr/0012-fused-kernel-bytes-from-op-dataflow.md"]
---

Fusion can remove traffic for [[intermediate|intermediates]] but never for these. The [[kv-cache]] is read by later steps and the sampled tokens are the step's output.
