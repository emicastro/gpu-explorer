---
id: packgqa
name: "PackGQA"
short: "An FA3 technique that packs the query heads sharing a KV head into one tile, so that KV head is read once."
related: ["gqa", "split-kv", "tile"]
sources: ["Shah et al., FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision, arXiv:2407.08608"]
---

With [[gqa]], several query heads attend to the same keys and values. PackGQA stacks those heads into the rows of one [[tile]], so the shared KV is loaded once for the whole group. In decode for Qwen3-8B the attention kernel therefore works per KV head, not per query head.
