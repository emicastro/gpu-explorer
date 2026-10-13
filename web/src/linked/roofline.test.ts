import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, initCoreSync, type StepPlan } from '../core/index.ts';
import { DEFAULT_SCENARIO, toScenario } from '../state/store.ts';
import { decadeRange, hbmSegments, logFrac, roofPoints } from './roofline.ts';

let plan: StepPlan;
let huge: StepPlan;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario(DEFAULT_SCENARIO));
  huge = evaluate('h100-sxm', 'qwen3-8b', toScenario({ ...DEFAULT_SCENARIO, batch: 64, context: 131072 }));
});

describe('roofPoints', () => {
  it('puts every kernel with FLOPs under the roofs', () => {
    const points = roofPoints(plan);
    expect(points.length).toBeGreaterThan(plan.layers.length);
    const bw = plan.roofs.hbmBandwidth.value;
    const peak = plan.roofs.bf16Peak.value;
    for (const p of points) expect(p.perf).toBeLessThanOrEqual(Math.min(peak, bw * p.intensity) * 1.001);
  });
});

describe('log axes', () => {
  it('pads to whole decades and maps them to 0..1', () => {
    const r = decadeRange([3, 700]);
    expect(r).toEqual({ min: 1, max: 1000 });
    expect(logFrac(1, r)).toBe(0);
    expect(logFrac(1000, r)).toBeCloseTo(1, 12);
    expect(logFrac(10, r)).toBeCloseTo(1 / 3, 12);
  });
});

describe('hbmSegments', () => {
  it('fills the capacity without overflow', () => {
    const bar = hbmSegments(plan);
    expect(bar.overflow).toBe(false);
    expect(bar.segments.reduce((s, x) => s + x.frac, 0)).toBeCloseTo(1, 9);
  });

  it('grows past the capacity on overflow, with no free space', () => {
    const bar = hbmSegments(huge);
    expect(bar.overflow).toBe(true);
    expect(bar.total).toBeGreaterThan(huge.memory.capacity.value);
    expect(bar.segments.find((s) => s.key === 'free')?.bytes).toBe(0);
  });
});
