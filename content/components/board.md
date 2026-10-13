---
id: board
does: "The H100 SXM module: the GPU package on a circuit board with its power delivery, and the connector that plugs it into a server."
stores: "Nothing the model uses. The memory is on the package."
---

This is the whole GPU as it arrives in a server: a flat board with the H100 package in the middle and power circuitry around it. Everything this explorer shows happens on it.

## Why it exists

A chip can't plug straight into a server. Something has to turn the server's supply into the steady low voltage the chip needs, cool it, and carry its signals out. The module does that, and its connector carries the links to the host CPU and to other GPUs.

## In a decode step

The host CPU launches the step's [[kernel|kernels]] and sends in the new token ids. Everything after that stays on the module until the next token comes out: the [[hbm]] streams the weights and the [[kv-cache]], the [[sm|SMs]] do the math, and the result goes back to the host. This explorer models one GPU, so nothing crosses the links to other GPUs here.
