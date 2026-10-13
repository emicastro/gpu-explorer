# 0024 — A folded layer is one steady summary in the scene

Status: accepted
Date: 2026-10-13

## Context

Design §6.5 (task 6.2) says that inside a folded layer the segment's time is shared among its ~11 kernels by GPU time, "so the scene keeps animating". At 1× a folded layer lasts ~0.2 s, so each kernel gets under a frame. Particles, SM colours, the flow label and the panel change ~60 times a second (seen on the M1; 0.25× only slows it). Real mode has no `T_MIN`, so a short kernel in the focused layer does the same.

`sceneKernel` (ADR 0020) names one kernel, and the scene, `FlowLabel`, the occupancy card and the panel read it through `sceneKernel(plan, ref)`.

## Options

- **A — Hold one kernel:** a folded layer keeps the scene on its first kernel. Stable, but it shows a single kernel as if it were the layer, with the wrong bytes.
- **B — Summary subject:** the scene shows a synthetic `KernelPlan` for the layer: summed bytes and traffic classes, time-weighted mean SM occupancy, one wave. A `summary` field in the store says it is on, and a notice says why and how to unfold.
- **C — Slow the folded layer down:** stretch it on the axis until each kernel lasts `T_MIN`. A layer would take ~1.7 s, so the step would take minutes.

## Decision

**B.** The scene's subject is the kernel, or, while the playhead is in a folded layer, the layer's summary (`layerSummary` in `plan/kernels.ts`). Its numbers are sums of the plan's own, so a stream's bytes are the layer's real traffic. The occupancy is the mean of `min(per_wave, SMs)` over each kernel's waves, weighted by GPU time, `simplified`. The notice names the Layer selector as the way to see each kernel.

The same subject covers Real mode: a kernel in a layer that lasts less than `T_MIN` on the axis shows its layer's summary too (reason `brief`), with a notice that Didactic mode shows each kernel. Kernels outside the layer loop always show themselves.

While a summary is on, `sceneKernel` holds the layer's first kernel, set once on entering. The kernel bars and the roofline then mark that one, and a seek still finds its kernel. `kernelAt` returns which summary (if any) the playhead is in, in place of sharing the segment out among the kernels.

## Consequences

- The scene changes at most when the playhead crosses a segment of at least `T_MIN`; in Didactic mode that is at most ~6 times a second.
- In Real mode the focused layer alternates between its summary and its long kernels (the GEMMs). That is fewer changes than before but not none; unfolding for a stable read is the Didactic mode's job.
- The wave clock does not run on a summary (one wave).
- Outside the layer loop, Real mode still shows its few short kernels one by one.
- Replaces the "scene keeps animating" sentence of design §6.5.
