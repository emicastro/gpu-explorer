---
id: tpc
does: "A Texture Processing Cluster: a pair of SMs and the little hardware they share."
stores: "No data of its own."
---

The TPC is the floorplan's unit between the [[gpc]] and the [[sm]]: two SMs side by side. The name comes from graphics, where the pair shares texture hardware.

## Why it exists

Chips come out of the factory with small defects. Rather than throw away a die, the maker switches off the faulty parts, and on this chip that happens one TPC at a time. That is why the number of working [[sm|SMs]] is lower than the number on the silicon, and always even.

## In a decode step

Nothing in a decode step happens at the TPC level. Blocks are placed on its [[sm|SMs]] one by one. For the model, what counts about TPCs is how many are switched on.
