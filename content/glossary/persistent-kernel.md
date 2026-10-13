---
id: persistent-kernel
name: "Persistent kernel"
short: "A kernel that launches one block per SM and hands out tiles in rounds from inside, instead of one block per tile."
related: ["wave", "tile", "sm"]
sources: []
---

FA3, DeepGEMM and FlashInfer on H100 work this way. The "waves" of such a kernel are its rounds.
