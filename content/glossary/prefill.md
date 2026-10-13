---
id: prefill
name: "Prefill"
short: "The phase that reads the whole prompt at once and fills the KV cache. Many tokens per step, usually compute-bound."
related: ["decode", "kv-cache"]
sources: []
---

In prefill every prompt token goes through the model in one pass, so the matrix multiplications are large and keep the [[tensor-core|tensor cores]] busy. It is the phase that is usually limited by compute, and it ends with the [[kv-cache]] full of the prompt's keys and values.
