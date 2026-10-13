---
id: moe
name: "Mixture of experts (MoE)"
short: "The MLP is replaced by many experts and a router that picks a few per token. Many parameters in total, few active."
related: ["decode"]
sources: ["Shazeer et al., Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer, arXiv:1701.06538"]
---

A router scores the experts for each token and sends the token to its top few. Only those experts' weights are used for that token, so compute per token stays small while the total parameter count is large. In [[decode]] a batch can still touch many experts, and their weights must all be read.
