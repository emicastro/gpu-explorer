// Geometry of the roofline and the HBM bar (design §6.8). Pure.
import type { StepPlan } from '../generated/StepPlan.ts';

export interface RoofPoint {
  /** Index into `plan.kernels`. */
  index: number;
  /** FLOP/byte and FLOP/s. */
  intensity: number;
  perf: number;
}

/** A kernel with no FLOPs (a copy) has no place on a log axis; it is left off. */
export function roofPoints(plan: StepPlan): RoofPoint[] {
  const points: RoofPoint[] = [];
  plan.kernels.forEach((k, index) => {
    const perf = k.flops.value / k.time.realistic.value;
    if (k.intensity.value > 0 && perf > 0 && Number.isFinite(perf)) points.push({ index, intensity: k.intensity.value, perf });
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

/** The bar's segments over HBM capacity; on overflow the bar grows past it and the KV is the excess. */
export function hbmSegments(plan: StepPlan): { segments: HbmSegment[]; total: number; overflow: boolean } {
  const m = plan.memory;
  const parts: [HbmSegment['key'], string, number][] = [
    ['weights', 'Weights', m.weights.value],
    ['kv', 'KV cache', m.kv.value],
    ['other', 'Activations + reserve', m.activations.value + m.headroom.value],
    ['free', 'Free', m.free.value],
  ];
  const total = Math.max(m.capacity.value, parts.reduce((s, p) => s + p[2], 0));
  return {
    segments: parts.map(([key, label, bytes]) => ({ key, label, bytes, frac: bytes / total })),
    total,
    overflow: m.overflow,
  };
}
