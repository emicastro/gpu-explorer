---
id: register-file
does: "The fastest storage on the chip: the private registers of every thread running on the sub-partition."
stores: "Every thread's live values. For a matrix multiplication, mostly the running sums of its output [[tile]]."
---

The register file holds the variables each thread is working on right now. It is the fastest memory on the [[sm]], and each thread sees only its own registers.

## Why it exists

The math units read their operands from registers and write their results back there. To keep many [[warp|warps]] resident, the GPU gives each sub-partition a big pool of registers and splits it among the warps it runs.

## In a decode step

In a weight multiplication, each thread keeps a piece of the output [[tile]] here and adds to it as weight tiles arrive. How many registers a kernel's threads need decides how many warps fit on an [[sm]]. Fewer warps means fewer loads in flight, which hurts a memory-bound decode kernel.

## Think of it as

What a cook holds in their hands: instant to use, but there is room for very little.
