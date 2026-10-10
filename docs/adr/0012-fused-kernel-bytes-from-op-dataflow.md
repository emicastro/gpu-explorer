# 0012 — Fused-kernel bytes from op-level tensor dataflow

Status: accepted
Date: 2026-10-10

## Context

Design §4.2 says the HBM bytes of a fused kernel are the kernel's input and output, not the sum of its ops, and that the difference is the "fusion saving" the UI shows (brief D7). Task 3.2 has to turn that into numbers for every kernel the fusion profile (ADR 0011) can produce. The hard cases:

- The residual + RMSNorm kernel reads `x` and `residual` and writes both the normalized output and the new residual, because the next residual add needs it. An intermediate that is also used later is not free.
- The KV cache is written by one kernel and read by another, and it is never an intermediate, whatever the fusion.
- The QKV GEMM writes one buffer that two different kernels consume: Q and K go to QK-norm + RoPE, and V goes to the cache write.
- Attention spans two kernels (FA3 and `combine`), with split partials crossing between them.

The profile already lists the ops each kernel fuses. It doesn't say which tensors cross the kernel boundary.

## Options

- **A — derive from dataflow:** each op declares the tensors it reads and writes (id, bytes, persistent or not). A kernel reads the tensors its ops read that no earlier op in the kernel wrote, and writes the tensors its ops write that some op in another kernel reads, plus every persistent tensor (KV cache, sampled tokens).
- **B — annotate the profile:** each template lists its input and output tensors by hand, next to `ops`, and the core sums their sizes.

## Decision

**A.** The boundary follows from facts the core already has: which op writes a tensor and which kernel runs each op. Annotations (B) would restate them in about 50 templates, and nothing would catch a template that drops a tensor. With A, a new fusion in the profile gets correct bytes without a data edit. Attention partials are the one exception: they don't exist at the op level, so the roofline adds them to the FA3 → `combine` boundary explicitly.

## Consequences

- Every op in `ops.rs` needs a full, honest read/write list, including weights, norm weights and FP8 scales. A missing read shows up as missing bytes, not as an error. Tests pin the totals that the brief §8 checks (≈ 15.1 GB per BF16 decode step).
- Unfused bytes (the sum of op-level traffic) and fused bytes come from the same lists, so the fusion saving is always consistent with them.
- A tensor that a later kernel reads only partly (the LM head reads one row per request of the final norm's output) still keeps the whole write. The writer writes all of it.
- Whether a fused kernel really avoids an intermediate (in registers or shared memory) is assumed, not checked. That is the definition of fusion that the trace supports (D14).
