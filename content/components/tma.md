---
id: tma
does: "The Tensor Memory Accelerator: copies whole tiles between global memory and [[shared-memory]] on its own, so the threads don't issue each load."
stores: "Nothing; it moves data in flight."
---

The [[tma]] is a copy engine inside each [[sm]], new on Hopper. A thread describes a [[tile]] once, with its start, shape and stride, and the TMA fetches all of it into [[shared-memory]] and signals when it has arrived.

## Why it exists

Without it, every thread spends instructions and registers computing addresses and issuing loads. Handing the copy to dedicated hardware frees the threads to compute, and lets a few of them keep a deep queue of copies in flight.

## In a decode step

Kernels written for Hopper, such as FlashAttention-3 for attention and the DeepGEMM-style FP8 weight multiplications, start the copy of the next tile and compute on the current one while it arrives. That keeps [[hbm]] busy all the time, which is what a memory-bound decode kernel needs.

## Think of it as

A conveyor belt that brings the next tray to the counter while the cook works on the current one. Nobody has to walk to fetch each item.
