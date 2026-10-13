// The step as a sequence of segments on a time axis (design §6.5). Pure: the
// playhead (task 6.2) reads it, nothing here moves.
import type { StepPlan } from '../generated/StepPlan.ts';
import { refOf, type KernelRef } from '../plan/kernels.ts';
import type { TimeMode } from '../state/types.ts';

export type { TimeMode };

/** Didactic mode: the shortest a segment lasts on the axis, in seconds. */
export const T_MIN = 0.15;
/** Axis seconds per real second (1 µs of GPU time is 1 ms on the axis), so a 7 ms step plays in seconds. */
export const DIDACTIC_SCALE = 1000;

export interface Segment {
  /** A single kernel, or a whole layer folded into one segment. */
  kind: 'kernel' | 'layer';
  /** Where it starts on the axis, in seconds. */
  start: number;
  /** How long it lasts on the axis, in seconds. */
  duration: number;
  /** The GPU time it stands for (the plan's realistic time), in seconds. */
  real: number;
  /** `null` outside the layer loop. */
  layer: number | null;
  /** `plan.kernels[first..end]` are the kernels it covers. */
  first: number;
  end: number;
  /** The kernel's name that survives re-evaluation (ADR 0020); null for a folded layer. */
  ref: KernelRef | null;
}

/** Axis seconds for `real` seconds of GPU time. */
export const axisSeconds = (real: number, mode: TimeMode): number =>
  mode === 'didactic' ? Math.max(T_MIN, DIDACTIC_SCALE * real) : DIDACTIC_SCALE * real;

/**
 * The step's segments in launch order. Layers other than `focusLayer` fold into
 * one segment each; the kernels outside the layer loop are always shown.
 */
export function buildTimeline(plan: StepPlan, mode: TimeMode, focusLayer: number | null): Segment[] {
  const spanAt = new Map<number, (typeof plan.layers)[number]>();
  for (const span of plan.layers) for (let i = span.start; i < span.end; i++) spanAt.set(i, span);
  const real = (first: number, end: number): number =>
    plan.kernels.slice(first, end).reduce((sum, k) => sum + k.time.realistic.value, 0);

  const segments: Segment[] = [];
  let clock = 0;
  const push = (s: Omit<Segment, 'start' | 'duration'>): void => {
    const duration = axisSeconds(s.real, mode);
    segments.push({ ...s, start: clock, duration });
    clock += duration;
  };

  for (let i = 0; i < plan.kernels.length; ) {
    const kernel = plan.kernels[i];
    if (!kernel) break;
    const span = spanAt.get(i);
    if (span && span.layer !== focusLayer && i === span.start) {
      push({ kind: 'layer', real: real(span.start, span.end), layer: span.layer, first: span.start, end: span.end, ref: null });
      i = span.end;
      continue;
    }
    push({
      kind: 'kernel',
      real: kernel.time.realistic.value,
      layer: span?.layer ?? null,
      first: i,
      end: i + 1,
      ref: refOf(plan, kernel),
    });
    i++;
  }
  return segments;
}

/** The axis length, in seconds. */
export const totalDuration = (segments: Segment[]): number => {
  const last = segments[segments.length - 1];
  return last ? last.start + last.duration : 0;
};

/** The segment under time `t` (clamped to the ends); null for an empty timeline. */
export function segmentAt(segments: Segment[], t: number): Segment | null {
  let found: Segment | null = null;
  for (const s of segments) {
    if (s.start > t) break;
    found = s;
  }
  return found ?? segments[0] ?? null;
}

/** Where each layer begins on the axis, for the scrub bar's marks. */
export function layerMarks(segments: Segment[]): { layer: number; at: number }[] {
  const marks: { layer: number; at: number }[] = [];
  for (const s of segments) {
    if (s.layer === null || marks.some((m) => m.layer === s.layer)) continue;
    marks.push({ layer: s.layer, at: s.start });
  }
  return marks;
}
