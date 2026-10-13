---
id: cuda-graphs
name: "CUDA graphs"
short: "Record a sequence of kernel launches once and replay it with a single call, to cut launch overhead."
related: ["kernel", "torch-compile"]
sources: ["NVIDIA, CUDA C++ Programming Guide, section on CUDA Graphs"]
---

vLLM uses them for steps up to a size limit. In decode the graph is full and includes attention; in prefill it is piecewise and attention stays outside. A graph is recorded for a fixed size, so vLLM pads the step up to the nearest captured size, and the matrix multiplications work on the padded token count.
