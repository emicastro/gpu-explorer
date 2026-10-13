---
id: sm
does: "The Streaming Multiprocessor: the GPU's basic unit of work. It runs [[thread-block|thread blocks]] on its math units, next to its own fast memory."
stores: "Registers, [[shared-memory]] and L1 cache: the working set of the [[thread-block|blocks]] it is running."
---

The SM is where a kernel's math actually happens. Each one has four sub-partitions with their own math units, a pool of registers, a block of [[shared-memory]] and L1 cache, and a [[tma]] to move data in. The die carries many identical copies.

## Why it exists

A GPU gets its speed from doing the same work on many pieces of data at once. Many small, identical SMs scale better than one huge core. Each has its own fast memory, so most of the work never leaves the SM.

## In a decode step

Every [[kernel]] of the step is cut into [[thread-block|blocks]], and each block runs on one SM. For a weight multiplication, a block reads its [[tile]] of the weight matrix and multiplies it by the few tokens of the batch. For attention, a block reads the [[kv-cache]] of one request and head. An SM runs several blocks at once if their registers, [[shared-memory]] and warp slots fit. A kernel with fewer blocks than SMs leaves some idle; one with more runs in [[wave|waves]]. Attention at batch 1 has few blocks, which is what [[split-kv]] fixes.

## Think of it as

A cooking station in a big kitchen. It has its own cooks, its own counter and a few orders in progress at once. The kitchen is fast because it has many stations, not because any one of them is.
