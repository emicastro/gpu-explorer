---
id: wave
name: "Wave"
short: "A batch of thread blocks that fills all the SMs at once. If the number of tiles is not a multiple of the SMs available, the last wave is partial."
related: ["tile", "thread-block", "persistent-kernel", "split-kv"]
sources: []
---

This is wave quantization: a kernel with one block more than fits in a wave pays for a whole extra wave. [[persistent-kernel|Persistent kernels]] replace waves with rounds inside each block.
