---
id: subpartition
does: "A quarter of an SM: one warp scheduler with its own slice of registers, a tensor core and the scalar math units."
stores: "Its slice of the register file: the live values of the warps assigned to it."
---

An [[sm]] is split into four sub-partitions. Each has a [[warp]] scheduler, a slice of the register file, a [[tensor-core]], and rows of [[cuda-core|FP32]], INT32 and FP64 lanes, load/store units and special function units.

## Why it exists

One scheduler feeding every unit of a whole SM would need long wires and could pick only one instruction per cycle. Four smaller copies each issue an instruction every cycle and keep their units close by.

## In a decode step

Each [[warp]] of a block is bound to one sub-partition for its whole life. In a weight-multiplication kernel, the [[tensor-core]] does the math and the other units mostly handle addresses and loads. In a norm or activation kernel, the [[cuda-core|CUDA cores]] do the arithmetic.
