---
id: roofline
name: "Roofline"
short: "A model that bounds a kernel's performance by the compute peak or by memory bandwidth, depending on its arithmetic intensity."
related: ["arithmetic-intensity", "ridge-point", "lower-bound"]
sources: ["Williams, Waterman and Patterson, Roofline: an insightful visual performance model for multicore architectures, CACM 52(4), 2009"]
---

Plot attainable FLOP/s against [[arithmetic-intensity]]. Left of the [[ridge-point]] the ceiling is a slope set by bandwidth; right of it, a flat line set by peak compute. A kernel can never sit above the line, and its distance below it is what the [[realistic-time]] adds on top of the [[lower-bound]].
