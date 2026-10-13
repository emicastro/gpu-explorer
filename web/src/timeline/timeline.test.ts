import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, initCoreSync, type StepPlan } from '../core/index.ts';
import { resolveKernel } from '../plan/kernels.ts';
import { DEFAULT_SCENARIO, toScenario } from '../state/store.ts';
import { DIDACTIC_SCALE, T_MIN, buildTimeline, layerMarks, segmentAt, totalDuration } from './timeline.ts';

let plan: StepPlan;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario(DEFAULT_SCENARIO));
});

const realTotal = () => plan.kernels.reduce((s, k) => s + k.time.realistic.value, 0);

describe('buildTimeline', () => {
  it('in didactic mode no segment lasts less than the minimum, and the formula is max(t_min, scale · t_real)', () => {
    for (const focus of [null, 0, 17]) {
      for (const s of buildTimeline(plan, 'didactic', focus)) {
        expect(s.duration).toBeGreaterThanOrEqual(T_MIN);
        expect(s.duration).toBeCloseTo(Math.max(T_MIN, DIDACTIC_SCALE * s.real), 12);
      }
    }
  });

  it('in real mode durations are proportional to the GPU times, with no minimum', () => {
    const segments = buildTimeline(plan, 'real', 3);
    const ratios = segments.map((s) => s.duration / s.real);
    expect(Math.max(...ratios)).toBeCloseTo(Math.min(...ratios), 9);
    expect(totalDuration(segments)).toBeCloseTo(DIDACTIC_SCALE * realTotal(), 9);
    expect(Math.min(...segments.map((s) => s.duration))).toBeLessThan(T_MIN);
  });

  it('folds every layer but the focused one into one segment, and covers each kernel exactly once', () => {
    const segments = buildTimeline(plan, 'didactic', 3);
    const folded = segments.filter((s) => s.kind === 'layer');
    expect(folded).toHaveLength(plan.layers.length - 1);
    expect(folded.some((s) => s.layer === 3)).toBe(false);
    const span = plan.layers.find((l) => l.layer === 3);
    if (!span) throw new Error('no layer 3');
    expect(segments.filter((s) => s.kind === 'kernel' && s.layer === 3)).toHaveLength(span.end - span.start);
    const covered = segments.flatMap((s) => Array.from({ length: s.end - s.first }, (_, i) => s.first + i));
    expect(covered).toEqual(plan.kernels.map((_, i) => i));
  });

  it('folds all layers when none is focused, and keeps the kernels outside the loop', () => {
    const segments = buildTimeline(plan, 'real', null);
    expect(segments.filter((s) => s.kind === 'layer')).toHaveLength(plan.layers.length);
    expect(segments.some((s) => s.kind === 'kernel' && s.layer === null)).toBe(true);
  });

  it('is contiguous, and each kernel segment names its own kernel', () => {
    const segments = buildTimeline(plan, 'didactic', 0);
    segments.forEach((s, i) => {
      const prev = segments[i - 1];
      if (prev) expect(s.start).toBeCloseTo(prev.start + prev.duration, 12);
      if (s.kind === 'kernel') {
        if (!s.ref) throw new Error('kernel segment without ref');
        expect(resolveKernel(plan, s.ref)).toBe(plan.kernels[s.first]);
      } else {
        expect(s.ref).toBeNull();
      }
    });
  });
});

describe('scrub helpers', () => {
  it('marks every layer once, in order, at the start of its first segment', () => {
    const segments = buildTimeline(plan, 'didactic', 5);
    const marks = layerMarks(segments);
    expect(marks.map((m) => m.layer)).toEqual(plan.layers.map((l) => l.layer));
    expect(marks.every((m, i) => i === 0 || m.at > (marks[i - 1]?.at ?? 0))).toBe(true);
  });

  it('finds the segment under a time and clamps outside the axis', () => {
    const segments = buildTimeline(plan, 'didactic', 0);
    const mid = segments[4];
    if (!mid) throw new Error('short timeline');
    expect(segmentAt(segments, mid.start + mid.duration / 2)).toBe(mid);
    expect(segmentAt(segments, -1)).toBe(segments[0]);
    expect(segmentAt(segments, 1e9)).toBe(segments[segments.length - 1]);
    expect(segmentAt([], 0)).toBeNull();
  });
});
