---
id: hbm-stack
does: "One stack of High Bandwidth Memory: DRAM chips stacked on top of each other, beside the GPU die, and joined to it through the interposer."
stores: "The model weights, the [[kv-cache]], and the activations that do not fit on chip. Capacity is the sum over all stacks."
---

[[hbm]] is the GPU's main memory. Each stack is a tower of DRAM chips, wired through vertically and placed right beside the [[die]] on the interposer. The model and everything it remembers between steps lives here.

## Why it exists

A model's weights are far bigger than anything that fits on the chip, so they need a large memory, and a GPU needs it to be fast. Stacking the DRAM and placing it next to the die allows a very wide connection, many more wires than ordinary memory on a board. That width is where the bandwidth comes from.

## In a decode step

Each decode step reads every weight of the model and every request's [[kv-cache]] from here, and writes back the new token's keys and values. The math is small next to those bytes, so the step's time is mostly this memory's bandwidth: that is the [[lower-bound]] of a memory-bound kernel. The capacity limits how many requests and how long a context fit.

## Think of it as

The storeroom next to the kitchen: everything is kept there, but every trip takes time. To make one token, the cooks need every ingredient once, so a decode step is mostly carrying crates.
