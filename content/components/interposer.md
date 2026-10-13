---
id: interposer
does: "A thin slice of silicon under the die and the HBM stacks, with very fine wiring that joins them."
stores: "Nothing. It carries signals between the die and each [[hbm]] stack."
---

The interposer is a flat piece of silicon that the [[die]] and the [[hbm]] stacks sit on, side by side. It holds no transistors that compute, only layers of wiring, plus vertical connections down to the substrate below.

## Why it exists

Each [[hbm]] stack needs thousands of connections to the die. Wires on an ordinary circuit board are far too coarse for that. Wires etched into silicon can be as fine as those on the chip itself, which is what lets the memory sit beside the GPU and still reach several TB/s.

## In a decode step

Every byte the step reads from [[hbm]], the weights and the [[kv-cache]], crosses the interposer on its way to the die, and the new keys and values cross it back. Its wiring is what makes those trips fast.
