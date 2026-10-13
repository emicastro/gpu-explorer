---
id: sfu
does: "The special function units: reciprocal, exponential, square root and similar functions, in hardware."
stores: "Nothing; operands are in registers."
---

A few units per sub-partition compute functions that ordinary multiply-adds can't do quickly: exponentials, reciprocals, square roots, sines and cosines. They give a fast approximation in one instruction.

## Why it exists

Writing these functions out in plain arithmetic would take many instructions each. They are needed often enough to deserve hardware, and rarely enough that a few units per sub-partition are enough.

## In a decode step

The exponentials of attention's softmax and of the SiLU in the MLP run here, as does the reciprocal square root of [[rmsnorm|RMSNorm]]. Their share of the step's time is small, because those kernels wait on memory far longer than on these units.

## Think of it as

The special keys of a calculator, such as square root and exponent. They are slower than + and ×, and you only press them now and then.
