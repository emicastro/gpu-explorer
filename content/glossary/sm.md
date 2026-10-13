---
id: sm
name: "Streaming multiprocessor (SM)"
short: "The replicated compute unit of the GPU. It runs [[thread-block|thread blocks]] and holds sub-partitions, shared memory and tensor cores."
related: ["thread-block", "warp", "shared-memory", "tpc"]
sources: ["NVIDIA H100 Tensor Core GPU Architecture whitepaper"]
---

A GPU is mostly many SMs. Each runs several [[thread-block|thread blocks]] at once, limited by its registers, [[shared-memory]], warps and blocks. How full the SMs are over time is what the occupancy view shows.
