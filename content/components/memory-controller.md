---
id: memory-controller
does: "Talks to one slice of the HBM: it turns the loads and stores from the L2 into memory commands."
stores: "Nothing; it queues requests."
---

Together the controllers set the bandwidth to [[hbm]]. Some are fused off on this chip, so the bandwidth the model uses is below what the full die could do.
