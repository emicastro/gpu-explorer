// Where the playhead is on the step, and what the scene shows there (design
// §6.5, ADR 0020). The pure part: no store, no clock.
import type { StepPlan } from '../generated/StepPlan.ts';
import { sceneKernel, type KernelRef, type SceneSummary } from '../plan/kernels.ts';
import { buildTimeline, segmentAt, T_MIN, type Segment, type TimeMode } from '../timeline/timeline.ts';

/** The speeds the transport offers (R10). */
export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/** The playhead after `dt` seconds at `speed`, and whether it hit the end of the axis. */
export function advance(t: number, dt: number, speed: number, total: number): { t: number; ended: boolean } {
  const next = t + dt * speed;
  return next >= total ? { t: total, ended: true } : { t: Math.max(next, 0), ended: false };
}

/** The kernel under the playhead, and how far through it (0..1). */
export interface Under {
  /** Index into `plan.kernels`: for a summary, the layer's first kernel. */
  index: number;
  progress: number;
  /** Set when the scene shows the layer's summary and not the kernel (ADR 0024). */
  summary: SceneSummary | null;
}

/**
 * The kernel at time `t`. A folded layer, and a layer kernel shorter than
 * `T_MIN` (Real mode), are too quick to show one by one: they come back as a
 * summary of their layer, which holds still for the whole segment.
 */
export function kernelAt(plan: StepPlan, segments: Segment[], t: number): Under | null {
  const s = segmentAt(segments, t);
  if (!s) return null;
  const f = s.duration > 0 ? clamp01((t - s.start) / s.duration) : 0;
  if (s.layer !== null) {
    if (s.kind === 'layer') return { index: s.first, progress: f, summary: { layer: s.layer, why: 'folded' } };
    if (s.duration < T_MIN - 1e-9) {
      const first = plan.layers.find((l) => l.layer === s.layer)?.start ?? s.first;
      return { index: first, progress: f, summary: { layer: s.layer, why: 'brief' } };
    }
  }
  return { index: s.first, progress: f, summary: null };
}

/** The axis time at which kernel `index` begins (a kernel in a folded layer: where the layer begins). */
export function startOfKernel(_plan: StepPlan, segments: Segment[], index: number): number {
  return segments.find((x) => x.first <= index && index < x.end)?.start ?? 0;
}

/** The wave a kernel of `waves` waves is on, `progress` (0..1) of the way through it. */
export const waveAtProgress = (progress: number, waves: number): number =>
  waves <= 1 ? 0 : Math.min(Math.floor(clamp01(progress) * waves), waves - 1);

/** The index of the kernel `ref` names in `plan` (the default one if the plan has none). */
export function kernelIndex(plan: StepPlan, ref: KernelRef): number {
  const kernel = sceneKernel(plan, ref);
  return kernel ? plan.kernels.indexOf(kernel) : 0;
}

// The same plan, mode and focus give the same segments: the driver, the
// transport and the picker all ask, and the plan has ~400 kernels.
let cached: { plan: StepPlan; mode: TimeMode; focus: number | null; segments: Segment[] } | null = null;

/** `buildTimeline`, remembering the last answer. */
export function timelineFor(plan: StepPlan, mode: TimeMode, focus: number | null): Segment[] {
  if (cached?.plan === plan && cached.mode === mode && cached.focus === focus) return cached.segments;
  const segments = buildTimeline(plan, mode, focus);
  cached = { plan, mode, focus, segments };
  return segments;
}
