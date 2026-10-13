# 0020 — The order tiles land on SMs, and the kernel the scene shows

Status: accepted
Date: 2026-10-12

## Context

Task 5.3 lights the SMs that hold a block in each wave, at the die and GPC levels. Design §4.3 says the 3D assigns tiles to SMs "in SM index order", `simplified` because the real block scheduler is neither public nor deterministic. Two forks:

1. **Which physical SM is logical SM `i`?** The die draws 8 GPCs (6 with 16 enabled SMs, 2 with 18). The occupied *count* is the core's (`min(per_wave[i], 132)`); only *where* the lit SMs sit is open. Decode attention at batch 1 and 8k has 104 blocks.
2. **Which kernel does the scene show?** Until now it was fixed to the QKV GEMM (`FLOW_OP`). The 5.3 e2e needs the attention kernel. The playhead (task 6.2) and the kernel timeline (7.2) don't exist yet. The store's `selection` is one value shared by kernels and components, so opening a component's panel would drop a selected kernel.

## Options

SM order:

- **A — fill GPC by GPC, in layout order:** the first 104 SMs are six full GPCs and a part of the seventh.
- **B — round-robin over the GPCs:** SM `i` is the next free enabled SM of GPC `i mod 8` (skipping full GPCs); within a GPC, the layout order.

Scene kernel:

- **C — reuse `selection` (`kind: 'kernel'`):** no new state, but a component panel clears it.
- **D — a `sceneKernel: KernelRef` in the playback slice:** the kernel the scene, the flow label and the panel show, named by its first op (kind and layer) and `nth`, which kernel running that op it is. 6.2 sets it from the playhead; until then a picker in the occupancy card sets it.
- **E — a kernel index into `plan.kernels`:** simplest, but it points at another kernel after any re-evaluation that adds or drops kernels.

## Decision

**B** and **D**.

B: with A, 104 of 132 reads as "two GPCs idle", and entering a GPC shows it all lit or all dark, so the GPC-level highlight teaches nothing. With B every GPC shows the kernel's share (13 of 16 or 18 at 104 blocks), which is what the lesson is about. Both are equally `simplified`.

D: a kernel named by what it does survives a re-evaluation that renumbers kernels (FP8 adds quantization kernels, task 7.1). An op alone isn't enough: `prepare_inputs` runs in seven kernels, and a layer's `attention` in both `fa3` and `fa3_combine`. Hence `nth`.

## Consequences

- `occupancy/occupancy.ts` owns the logical → physical SM order. The die and GPC levels and the flow's landings all go through it.
- The flow lands only on SMs busy in the current wave (the narrowing the 4.4 code left to 5.3). Its routes change with the wave.
- Waves cycle on a scene clock until 6.2 ties them to the playhead.
- 6.2 writes `sceneKernel` instead of adding new state. 7.2 decides whether selecting a kernel bar also sets it.
- A ref whose kernel is gone after a re-evaluation (the `combine`, in a long prefill that FA3 doesn't split) falls back to the default, the QKV GEMM of layer 0.
