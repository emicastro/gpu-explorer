import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCENARIO, toScenario, useStore } from './store.ts';
import type { Knobs, StepPlan } from './types.ts';

const initial = useStore.getState();

beforeEach(() => {
  useStore.setState(initial, true);
  useStore.getState().setEvaluator(null);
});

describe('store slices', () => {
  it('starts with the default scenario and no plan, selection or path', () => {
    const s = useStore.getState();
    expect(s.scenario).toEqual(DEFAULT_SCENARIO);
    expect(s.plan).toBeNull();
    expect(s.selection).toBeNull();
    expect(s.path).toEqual([]);
    expect(s.playing).toBe(false);
  });

  it('re-evaluates synchronously on a scenario change and replaces the plan', () => {
    // A stand-in plan: the store only stores what the evaluator returns.
    const evaluate = vi.fn((k: Knobs) => ({ batch: k.batch }) as unknown as StepPlan);
    useStore.getState().setEvaluator(evaluate);
    const first = useStore.getState().plan;
    useStore.getState().setScenario({ batch: 8 });
    const second = useStore.getState().plan;
    expect(second).toEqual({ batch: 8 });
    expect(second).not.toBe(first);
    expect(useStore.getState().scenario).toEqual({ ...DEFAULT_SCENARIO, batch: 8 });
  });

  it('keeps the scenario and clears the plan when evaluate throws', () => {
    useStore.getState().setEvaluator(() => {
      throw new Error('batch does not fit in HBM');
    });
    useStore.getState().setScenario({ batch: 512 });
    expect(useStore.getState().scenario.batch).toBe(512);
    expect(useStore.getState().plan).toBeNull();
    expect(useStore.getState().planError).toBe('batch does not fit in HBM');
  });

  it('selection, playback and navigation update independently', () => {
    const s = useStore.getState();
    s.select({ kind: 'kernel', index: 3 });
    s.setPlayhead(0.5);
    s.setSpeed(4);
    s.setTimeMode('real');
    s.setPlaying(true);
    s.enter('die');
    s.enter('gpc0');
    s.back();
    const t = useStore.getState();
    expect(t.selection).toEqual({ kind: 'kernel', index: 3 });
    expect(t.playhead).toBe(0.5);
    expect(t.speed).toBe(4);
    expect(t.timeMode).toBe('real');
    expect(t.playing).toBe(true);
    expect(t.path).toEqual(['die']);
    t.back();
    useStore.getState().back();
    expect(useStore.getState().path).toEqual([]);
  });

  it('expands the knobs into one context per request', () => {
    const knobs: Knobs = { ...DEFAULT_SCENARIO, batch: 3, context: 4096 };
    expect(toScenario(knobs)).toEqual({
      phase: 'decode',
      contexts: [4096, 4096, 4096],
      newTokens: 1,
      weights: 'bf16',
      kv: 'bf16',
    });
    expect(toScenario({ ...knobs, phase: 'prefill' }).newTokens).toBe(4096);
  });
});

describe('component selection and navigation', () => {
  it('closes a component panel when the level changes, and leaves a kernel selection alone', () => {
    const s = useStore.getState();
    s.select({ kind: 'component', id: 'die' });
    s.enter('die');
    expect(useStore.getState().selection).toBeNull();
    useStore.getState().select({ kind: 'kernel', index: 3 });
    useStore.getState().back();
    expect(useStore.getState().selection).toEqual({ kind: 'kernel', index: 3 });
  });

  it('keeps a component panel while the camera settles', () => {
    useStore.getState().enter('die');
    useStore.getState().select({ kind: 'component', id: 'die' });
    useStore.getState().settle();
    expect(useStore.getState().selection).toEqual({ kind: 'component', id: 'die' });
  });
});
