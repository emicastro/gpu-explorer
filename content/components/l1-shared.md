---
id: l1-shared
does: "The SM's own on-chip memory, split between an automatic L1 cache and [[shared-memory]] that the program manages."
stores: "The [[tile]] being worked on, the values the [[thread-block|blocks]] on this SM share, and recently used global memory."
---

Each [[sm]] has one block of fast memory that it divides in two. One part is an L1 cache, filled automatically with recently loaded data. The other part is [[shared-memory]], which a kernel fills itself and which all threads of a [[thread-block|block]] can read.

## Why it exists

Registers belong to one thread, and [[hbm]] is far away. Threads that work together need a fast place to put data they all use. A kernel that loads a [[tile]] once into shared memory, and lets every thread read it there, avoids loading the same bytes many times.

## In a decode step

A weight-multiplication kernel stages the tiles of weights and activations here before the [[tensor-core|tensor cores]] read them. Attention stages tiles of the [[kv-cache]] the same way. How much shared memory a block asks for limits how many blocks the [[sm]] can run at once.

## Think of it as

The station's counter: ingredients laid out within reach, shared by the cooks working there.
