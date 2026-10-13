// Where the playhead is on the step, and what the scene shows there (design
// §6.5, ADR 0020). The pure part: no store, no clock.
import type { StepPlan } from '../generated/StepPlan.ts';
import { sceneKernel, type KernelRef } from '../plan/kernels.ts';
import { buildTimeline, segmentAt, type Segment, type TimeMode } from '../timeline/timeline.ts';

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
  /** Index into `plan.kernels`. */
  index: number;
  progress: number;
}

/**
 * The kernel at time `t`. Inside a folded layer the segment's time is shared
 * out among its kernels by their GPU time, so the scene keeps animating.
 */
export function kernelAt(plan: StepPlan, segments: Segment[], t: number): Under | null {
  const s = segmentAt(segments, t);
  if (!s) return null;
  const f = s.duration > 0 ? clamp01((t - s.start) / s.duration) : 0;
  if (s.kind === 'kernel') return { index: s.first, progress: f };
  let left = f * s.real;
  for (let i = s.first; i < s.end; i++) {
    const real = plan.kernels[i]?.time.realistic.value ?? 0;
    if (left < real || i === s.end - 1) return { index: i, progress: real > 0 ? clamp01(left / real) : 0 };
    left -= real;
  }
  return null;
}

/** The axis time at which kernel `index` begins. */
export function startOfKernel(plan: StepPlan, segments: Segment[], index: number): number {
  const s = segments.find((x) => x.first <= index && index < x.end);
  if (!s) return 0;
  if (s.kind === 'kernel' || s.real <= 0) return s.start;
  const before = plan.kernels.slice(s.first, index).reduce((sum, k) => sum + k.time.realistic.value, 0);
  return s.start + (s.duration * before) / s.real;
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
