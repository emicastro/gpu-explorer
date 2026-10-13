---
id: residual-stream
name: "Residual stream"
short: "The per-token vector that runs through all layers; attention and the MLP add their output to it."
related: ["rmsnorm", "kernel-fusion"]
sources: []
---

Each layer reads the stream, computes something from it and adds the result back. The kernel that fuses the residual add with [[rmsnorm]] writes the new stream to HBM even though it uses it right away, because the next residual add reads it again.
