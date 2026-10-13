---
id: die
does: "The silicon chip: the [[sm|SMs]], the [[l2-cache|L2 cache]] and the memory controllers, with the on-chip network that joins them."
stores: "Its [[l2-cache]] and, in each SM, registers and [[shared-memory]]. It has no bulk storage."
---

A kernel's blocks are spread over the [[gpc|GPCs]] and their [[sm|SMs]]; their loads go through the [[l2-cache]] to [[hbm]]. How many SMs get work depends on how many [[thread-block|blocks]] the kernel launches.
