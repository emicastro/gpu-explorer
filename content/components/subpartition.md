---
id: subpartition
does: "A slice of an SM: a warp scheduler, a slice of the register file, a tensor core and the scalar math units."
stores: "Its slice of the register file."
---

[[warp|Warps]] are bound to a sub-partition. Its scheduler issues their instructions to the units below. A matrix multiplication keeps the [[tensor-core]] fed; an elementwise kernel uses the [[cuda-core|CUDA cores]].
