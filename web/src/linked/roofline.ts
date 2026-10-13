// Geometry of the roofline and the HBM bar (design §6.8). Pure.
import type { StepPlan } from '../generated/StepPlan.ts';

export interface RoofPoint {
  /** Index into `plan.kernels`. */
  index: number;
  /** FLOP/byte and FLOP/s, both the core's (`intensity`, `attained`). */
  intensity: number;
  perf: number;
}

/** A kernel with no FLOPs (a copy) has no place on a log axis; it is left off. */
export function roofPoints(plan: StepPlan): RoofPoint[] {
  const points: RoofPoint[] = [];
  plan.kernels.forEach((k, index) => {
    const perf = k.attained.value;
    if (k.intensity.value > 0 && perf > 0) points.push({ index, intensity: k.intensity.value, perf });
  });
  return points;
}

export interface Range { min: number; max: number }

/** A log axis over decades: pads `values` out to whole powers of ten. */
export function decadeRange(values: number[]): Range {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const min = 10 ** Math.floor(Math.log10(lo));
  const max = 10 ** Math.ceil(Math.log10(hi));
  return max > min ? { min, max } : { min, max: min * 10 };
}

/** 0 at `min`, 1 at `max`. */
export const logFrac = (v: number, r: Range): number => (Math.log10(v) - Math.log10(r.min)) / (Math.log10(r.max) - Math.log10(r.min));

export interface HbmSegment {
  key: 'weights' | 'kv' | 'other' | 'free';
  label: string;
  bytes: number;
  /** Share of the bar. */
  frac: number;
}

export interface HbmBarGeometry {
  segments: HbmSegment[];
  /** What the bar spans: the capacity, or more on overflow. */
  total: number;
  /** Where the capacity ends on the bar (1 without overflow). */
  capacityFrac: number;
  /** Bytes past the capacity (0 without overflow). */
  excess: number;
  overflow: boolean;
}

/**
 * The bar's segments over HBM capacity. On overflow the bar spans what was
 * asked for, so the part right of `capacityFrac` is what does not fit.
 */
export function hbmSegments(plan: StepPlan): HbmBarGeometry {
  const m = plan.memory;
  const parts: [HbmSegment['key'], string, number][] = [
    ['weights', 'Weights', m.weights.value],
    ['kv', 'KV cache', m.kv.value],
    ['other', 'Activations + reserve', m.activations.value + m.headroom.value],
    ['free', 'Free', m.free.value],
  ];
  const capacity = m.capacity.value;
  const total = Math.max(capacity, parts.reduce((s, p) => s + p[2], 0));
  return {
    segments: parts.map(([key, label, bytes]) => ({ key, label, bytes, frac: bytes / total })),
    total,
    capacityFrac: capacity / total,
    excess: total - capacity,
    overflow: m.overflow,
  };
}
