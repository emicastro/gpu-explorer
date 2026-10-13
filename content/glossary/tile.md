---
id: tile
name: "Tile and tiling"
short: "Splitting an output matrix into blocks; each thread block computes one. It sets how many blocks there are and how much shared memory and how many registers each uses."
related: ["thread-block", "wave", "packgqa"]
sources: []
---

A bigger tile reuses each loaded value more, but gives fewer blocks, which can leave [[sm|SMs]] without work. See [[wave]] for what happens when the blocks do not divide evenly.
