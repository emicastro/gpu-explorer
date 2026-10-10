# 0013 — `Launch` carries resident slots, not shared memory and registers

Status: accepted
Date: 2026-10-10

## Context

Design §4.3 had every tiling module return a `Launch` that included `smem` and `regs`. Those are the inputs to occupancy: how many CTAs fit on an SM at once. What the rest of the core reads is the result of that calculation. The SM mapping needs `per_wave` (§6.6) and the realistic time needs the number of active SMs (§4.4).

The kernels that dominate a step are persistent: FA3 varlen, DeepGEMM and FlashInfer. Their source states the residency directly. For FA3 (`9cd61de`), `hopper/tile_scheduler.hpp` launches a grid of `num_sm` CTAs, and `hopper/flash_fwd_kernel_sm90.h` sets `MinBlocksPerMultiprocessor = 1`. FA3's shared memory, by contrast, is `SharedStorageSize`, which comes out of CUTLASS template layouts. It can't be cited without compiling, so carrying it would mean an estimated number that looks exact (R6).

Fine-grained occupancy is out of scope for v1 (requirements, "Fuera de alcance"; brief D3).

## Options

- **A — slots:** `Launch` carries `slots`, the CTAs resident at once (the persistent grid, or SMs × CTAs per SM). Each module derives it from whatever its source gives.
- **B — smem and regs:** `Launch` carries shared memory and registers per CTA, as in design §4.3, and a shared function derives the occupancy.
- **C — both:** `slots`, plus optional `smem` and `regs`, each with its own provenance.

## Decision

**A.** It carries the one number downstream code uses, and for persistent kernels that number is `documented` straight from the source. B forces an estimate where the source gives a fact. C adds fields that nothing reads in v1.

## Consequences

- `ondas = ⌈blocks / slots⌉` and `per_wave` work the same for persistent and non-persistent kernels.
- Non-persistent modules (`cublas_bf16`, the elementwise kernels) compute their own CTAs per SM from the SM limits already in `h100-sxm.json` (`maxThreads`, `maxBlocks`, `registers`). To avoid duplicating that logic, it goes in one helper in `tiling/mod.rs`, written by the first task that needs it.
- No test can check a kernel's shared memory against the SM limit. The UI can't show "this kernel uses X KB of shared memory".
- If the SM panel (R9) ever wants that, C is the path: optional fields with their own confidence, added without changing `slots`.
