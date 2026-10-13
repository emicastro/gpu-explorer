---
id: board
does: "The H100 SXM module: the package with its power delivery and the connector that mounts it in a server."
stores: "Nothing of its own that the model uses; the memory is on the package."
---

The whole module is what the LLM runs on. Everything below it is where the time goes: the [[hbm]] streams the weights and the [[kv-cache]] in, the [[sm|SMs]] do the math, and the result goes back out.
