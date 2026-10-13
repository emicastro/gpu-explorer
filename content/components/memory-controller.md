---
id: memory-controller
does: "Manages one slice of the HBM: it turns the loads and stores coming from the L2 into memory commands."
stores: "Nothing; it queues requests."
---

Along the edges of the [[die]] sit the memory controllers, each wired to part of one [[hbm]] stack. A controller takes the requests the [[l2-cache]] could not serve and schedules them as commands to its DRAM.

## Why it exists

DRAM has its own rules: rows have to be opened before they are read, and the controller has to refresh them and avoid conflicts. Each controller handles that for its slice. Addresses are spread over all controllers, so a large read keeps all of them busy at once.

## In a decode step

Every byte a decode step reads from [[hbm]], the weights and the [[kv-cache]], goes through some controller. Because addresses are spread evenly, the step uses them all, and together they set the bandwidth. Some are switched off on this chip, together with their HBM site, so the bandwidth is below what the full design could reach.

## Think of it as

The loading doors between the kitchen and the storeroom. Each serves its own aisle, and goods arrive fastest when every door is in use.
