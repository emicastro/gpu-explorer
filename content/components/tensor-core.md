---
id: tensor-core
does: "Multiplies small matrices and accumulates the result in a single operation. It is where the GPU's huge matrix throughput comes from."
stores: "Nothing; operands come from registers or [[shared-memory]] and results go to registers."
---

A tensor core is a unit built for one thing: multiplying small matrices and adding the result to a running sum, all in one instruction. Each sub-partition has one. On Hopper, the four of an [[sm]] work together on one larger multiplication.

## Why it exists

Almost all of a model's arithmetic is matrix multiplication. Doing it a whole small matrix at a time, instead of one multiply-add per lane, gives many times the throughput of the [[cuda-core|CUDA cores]] for the same area and power. Lower precision runs faster still: FP8 doubles the BF16 rate.

## In a decode step

Every large matrix multiplication of the model runs here: the QKV and output projections, the MLP and the final projection to the vocabulary. The attention products in FlashAttention-3 run here as well. In [[decode]] each weight is used for only a few tokens, so the tensor cores finish each [[tile]] long before the next one arrives from [[hbm]]. Mostly they wait. A larger batch reuses the same weights for more tokens, which raises the [[arithmetic-intensity]].

## Think of it as

A machine that dices a whole tray of vegetables at once, while the cooks with knives do one at a time. In decode it spends most of the time waiting for the next tray.
