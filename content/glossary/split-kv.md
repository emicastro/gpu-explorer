---
id: split-kv
name: "Split-KV (FlashDecoding)"
short: "Cut the context of a decode attention into chunks handled by different blocks and combine the partial results at the end."
related: ["packgqa", "thread-block", "sm", "wave"]
sources: ["Dao et al., Flash-Decoding for long-context inference (Stanford CRFM blog, 2023)"]
---

In [[decode]] there is one query token per request, so attention has few independent pieces of work: one per request and KV head. With long contexts each piece is huge and the rest of the [[sm|SMs]] sit idle.

Split-KV cuts the context into chunks, gives each chunk to its own [[thread-block]], and merges the partial softmax results afterwards. How many chunks to use is a trade: more chunks fill more SMs but add a merge step.
