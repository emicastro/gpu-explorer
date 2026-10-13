---
id: kv-cache
name: "KV cache"
short: "The attention keys and values of earlier tokens, kept in [[hbm]] so they are not recomputed. It grows with layers, KV heads, context length and batch."
related: ["gqa", "hbm", "decode", "prefill"]
sources: []
---

Each new token attends to every earlier token. Instead of recomputing their keys and values at every step, the engine stores them. The cache is written during [[prefill]] and read in full at every [[decode]] step, so for long contexts it competes with the weights for bandwidth and capacity in [[hbm]].

[[gqa]] shrinks it by sharing one key/value head among several query heads.
