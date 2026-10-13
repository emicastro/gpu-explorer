---
id: torch-compile
name: "torch.compile and Inductor"
short: "The PyTorch compiler vLLM uses by default. Inductor generates Triton kernels that fuse elementwise operations."
related: ["kernel-fusion", "cuda-graphs"]
sources: ["Ansel et al., PyTorch 2: Faster Machine Learning Through Dynamic Python Bytecode Transformation and Graph Compilation, ASPLOS 2024"]
---

That is why the norm, residual and activation kernels in vLLM are not hand-written: Inductor fuses them into generated Triton kernels. See [[kernel-fusion]] for what fusing changes in the bytes.
