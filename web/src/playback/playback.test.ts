import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, initCoreSync, type StepPlan } from '../core/index.ts';
import { DEFAULT_KERNEL, resolveKernel } from '../plan/kernels.ts';
import { DEFAULT_SCENARIO, toScenario, useStore } from '../state/store.ts';
import { totalDuration } from '../timeline/timeline.ts';
import { seekToKernel, seekToLayer } from './driver.ts';
import { advance, kernelAt, kernelIndex, startOfKernel, timelineFor, waveAtProgress } from './playback.ts';

let plan: StepPlan;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario(DEFAULT_SCENARIO));
});

describe('advance', () => {
  it('moves by dt · speed and stops at the end', () => {
    expect(advance(1, 0.5, 2, 10)).toEqual({ t: 2, ended: false });
    expect(advance(9.5, 0.5, 2, 10)).toEqual({ t: 10, ended: true });
    expect(advance(0, 1, 0.25, 10).t).toBeCloseTo(0.25, 12);
  });
});

describe('kernelAt and startOfKernel', () => {
  it('finds each expanded kernel at its own start, and agrees with startOfKernel', () => {
    const segments = timelineFor(plan, 'didactic', 0);
    for (const s of segments.filter((x) => x.kind === 'kernel')) {
      expect(kernelAt(plan, segments, s.start + s.duration / 2)?.index).toBe(s.first);
      expect(startOfKernel(plan, segments, s.first)).toBe(s.start);
    }
  });

  it('shares a folded layer out among its kernels, so the scene keeps moving', () => {
    const segments = timelineFor(plan, 'didactic', 0);
    const folded = segments.find((s) => s.kind === 'layer' && s.layer === 3);
    if (!folded) throw new Error('layer 3 is not folded');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const under = kernelAt(plan, segments, folded.start + (folded.duration * (i + 0.5)) / 200);
      if (under) seen.add(under.index);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect([...seen].every((k) => k >= folded.first && k < folded.end)).toBe(true);
    // A kernel's start inside a folded layer lands back on that kernel.
    const k = folded.first + 4;
    expect(kernelAt(plan, segments, startOfKernel(plan, segments, k) + 1e-9)?.index).toBe(k);
  });

  it('is at the last kernel at the end of the axis, with progress 1', () => {
    const segments = timelineFor(plan, 'real', 0);
    const under = kernelAt(plan, segments, totalDuration(segments));
    expect(under?.index).toBe(plan.kernels.length - 1);
    expect(under?.progress).toBeCloseTo(1, 9);
  });
});

describe('waveAtProgress', () => {
  it('takes turns across the kernel, and stays in range', () => {
    expect(waveAtProgress(0, 4)).toBe(0);
    expect(waveAtProgress(0.5, 4)).toBe(2);
    expect(waveAtProgress(1, 4)).toBe(3);
    expect(waveAtProgress(0.9, 1)).toBe(0);
  });
});

describe('seeking', () => {
  it('puts the playhead on the first kernel of a layer and focuses it', () => {
    useStore.setState({ plan, timeMode: 'didactic', focusLayer: 0, playhead: 0 });
    seekToLayer(3);
    const s = useStore.getState();
    expect(s.focusLayer).toBe(3);
    const span = plan.layers.find((l) => l.layer === 3);
    expect(kernelIndex(plan, s.sceneKernel)).toBe(span?.start);
  });

  it('seeks to a kernel of the focused layer by moving the playhead', () => {
    useStore.setState({ plan, timeMode: 'didactic', focusLayer: 0, playhead: 0 });
    seekToKernel(DEFAULT_KERNEL);
    const s = useStore.getState();
    const segments = timelineFor(plan, 'didactic', 0);
    expect(s.playhead).toBe(startOfKernel(plan, segments, kernelIndex(plan, DEFAULT_KERNEL)));
    expect(resolveKernel(plan, s.sceneKernel)).toBe(resolveKernel(plan, DEFAULT_KERNEL));
  });
});
