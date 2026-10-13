---
id: int32-core
does: "The integer lanes. They compute indices and addresses."
stores: "Nothing; operands are in registers."
---

Every load in a kernel needs an address, and tile bookkeeping needs integer arithmetic. Embedding lookups and the paged [[kv-cache]] indexing lean on it more than most.
