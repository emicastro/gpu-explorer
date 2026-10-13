---
id: int32-core
does: "The integer lanes: they compute indices and addresses."
stores: "Nothing; operands are in registers."
---

These lanes do integer arithmetic, such as counting, indexing and building the address of the next value to load.

## Why it exists

Every load needs an address, and loops need counters. Integer lanes separate from the [[cuda-core|FP32 lanes]] let that bookkeeping run alongside the floating-point math instead of taking turns with it.

## In a decode step

Every load of a kernel needs an address. Tile loops need integer arithmetic. The embedding lookup and the paged [[kv-cache]], where each request's cache is found through a table of pages, lean on them more than most.
