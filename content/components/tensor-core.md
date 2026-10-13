---
id: tensor-core
does: "Multiplies small matrices and accumulates the result in a single operation. The reason for the GPU's high matrix throughput."
stores: "Nothing; operands come from registers or shared memory and results go to registers."
---

Every large matrix multiplication of the model (QKV, output projection, MLP, and the attention products in FA3) runs here. The peak depends on the precision: FP8 doubles the BF16 rate. In [[decode]] it is mostly waiting for weights to arrive from [[hbm]].
