---
id: gpc
does: "A cluster of TPCs that shares resources. The die has several, with unequal numbers of enabled SMs."
stores: "No data of its own; it groups the SMs below it."
---

Blocks are handed out to SMs wherever they are. The GPC matters because some GPCs have more enabled [[tpc|TPCs]] than others, so a kernel's blocks land on uneven groups of [[sm|SMs]].
