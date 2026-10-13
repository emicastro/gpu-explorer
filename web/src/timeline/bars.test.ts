import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, initCoreSync, type StepPlan } from '../core/index.ts';
import { DEFAULT_SCENARIO, toScenario } from '../state/store.ts';
import { kernelIndex, timelineFor } from '../playback/playback.ts';
import { DEFAULT_KERNEL } from '../plan/kernels.ts';
import { barsFor } from './bars.ts';

let plan: StepPlan;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario(DEFAULT_SCENARIO));
});

describe('barsFor', () => {
  it('tiles the axis: bars follow one another and end at 100 %', () => {
    const bars = barsFor(plan, timelineFor(plan, 'didactic', 0), 0);
    expect(bars.length).toBeGreaterThan(plan.layers.length);
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const bar = bars[i];
      expect((prev?.left ?? 0) + (prev?.width ?? 0)).toBeCloseTo(bar?.left ?? -1, 9);
    }
    const last = bars.at(-1);
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(100, 9);
  });

  it('lights exactly the bar that holds the scene kernel, folded or not', () => {
    const segments = timelineFor(plan, 'didactic', 0);
    const qkv = kernelIndex(plan, DEFAULT_KERNEL);
    const lit = barsFor(plan, segments, qkv).filter((b) => b.active);
    expect(lit).toHaveLength(1);
    expect(lit[0]?.segment.first).toBe(qkv);
    const inLayer3 = plan.layers[3]?.start ?? -1;
    const folded = barsFor(plan, segments, inLayer3 + 2).filter((b) => b.active);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.segment.kind).toBe('layer');
    expect(folded[0]?.label).toBe('layer 3');
  });

  it('tones a kernel by its bound and a folded layer apart', () => {
    const bars = barsFor(plan, timelineFor(plan, 'didactic', 0), 0);
    for (const bar of bars) {
      if (bar.segment.kind === 'layer') expect(bar.tone).toBe('layer');
      else expect(bar.tone).toBe(plan.kernels[bar.segment.first]?.bound);
    }
  });
});
