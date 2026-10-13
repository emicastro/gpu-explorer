---
id: gqa
name: "Grouped-query attention (GQA)"
short: "Several query heads share one key/value head, which shrinks the KV cache by the grouping factor."
related: ["kv-cache", "packgqa"]
sources: ["Ainslie et al., GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints, arXiv:2305.13245"]
---

Qwen3-8B has more query heads than KV heads, so each group of query heads reads the same keys and values. The [[kv-cache]] holds KV heads only, which is why it is much smaller than with one KV head per query head. [[packgqa]] uses the grouping to read each KV head once.
