---
id: package
does: "The die and the HBM stacks together on one silicon interposer."
stores: "The weights, the [[kv-cache]] and the activations in [[hbm]]; the working data on the die."
---

At this level the question is how many bytes cross between [[hbm]] and the [[die]] for a kernel. In [[decode]] that traffic, divided by the bandwidth, is usually the kernel's [[lower-bound]].
