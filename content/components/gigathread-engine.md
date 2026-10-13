---
id: gigathread-engine
does: "The scheduler for the whole chip: it hands each launched thread block to an SM that has room for it."
stores: "Nothing; it tracks which blocks are placed where."
---

When a kernel launches, this decides where its [[thread-block|blocks]] go. Its work is why blocks fill the [[sm|SMs]] in [[wave|waves]] and why an uneven final wave leaves some SMs idle.
