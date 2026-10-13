---
id: decode
name: "Decode"
short: "The phase that produces one new token per request per step. It reads all the weights to make few tokens, so it is usually memory-bound."
related: ["prefill", "kv-cache", "lower-bound"]
sources: []
---

A decode step multiplies tiny batches of activations by the whole weight matrices, so almost all the time goes to reading weights and the [[kv-cache]] from [[hbm]]. The math is small next to the bytes moved, which makes decode usually memory-bound: its [[lower-bound]] is set by bandwidth.
