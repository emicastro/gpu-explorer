---
id: package
does: "The die and the HBM stacks, mounted side by side on one silicon interposer."
stores: "The weights, the [[kv-cache]] and the activations, in [[hbm]]. The working data is on the die."
---

The package is the chip as you would hold it: the GPU [[die]] in the middle and the [[hbm]] stacks beside it, all on a silicon interposer. The interposer sits on a substrate inside a metal ring.

## Why it exists

A GPU needs both compute and a lot of memory close by. Putting the memory in the same package, a few millimetres from the die, gives far shorter and far more numerous wires than a board can, and that is where the bandwidth comes from.

## In a decode step

Each decode step reads every weight of the model once, plus the [[kv-cache]] of every request, from [[hbm]] into the die. At this level the question is how many bytes cross between them. That traffic divided by the bandwidth is usually the kernel's [[lower-bound]].
