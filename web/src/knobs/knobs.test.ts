import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX, CONTEXT_MAX, fromSlider, pick, STEPS, toSlider, WEIGHT_OPTIONS, YARN_FROM,
} from './knobs.ts';

describe('log sliders', () => {
  it('map the ends to 1 and the maximum', () => {
    expect(fromSlider(0, CONTEXT_MAX)).toBe(1);
    expect(fromSlider(STEPS, CONTEXT_MAX)).toBe(CONTEXT_MAX);
    expect(fromSlider(STEPS, BATCH_MAX)).toBe(BATCH_MAX);
    expect(toSlider(1, BATCH_MAX)).toBe(0);
    expect(toSlider(CONTEXT_MAX, CONTEXT_MAX)).toBe(STEPS);
  });

  it('are log: the middle of the context scale is its geometric mean', () => {
    expect(fromSlider(STEPS / 2, CONTEXT_MAX)).toBe(Math.round(Math.sqrt(CONTEXT_MAX)));
  });

  it('clamp out-of-range input', () => {
    expect(fromSlider(-5, BATCH_MAX)).toBe(1);
    expect(fromSlider(STEPS + 50, BATCH_MAX)).toBe(BATCH_MAX);
    expect(toSlider(0, BATCH_MAX)).toBe(0);
    expect(toSlider(10 * BATCH_MAX, BATCH_MAX)).toBe(STEPS);
  });

  it('round-trip within one slider step', () => {
    for (const v of [1, 2, 8, 350, 8192, YARN_FROM, 100000]) {
      const back = fromSlider(toSlider(v, CONTEXT_MAX), CONTEXT_MAX);
      expect(Math.abs(Math.log(back / v))).toBeLessThan(Math.log(CONTEXT_MAX) / STEPS);
    }
  });

  it('put the YaRN mark at 15/17 of the context scale', () => {
    expect(toSlider(YARN_FROM, CONTEXT_MAX) / STEPS).toBeCloseTo(15 / 17, 3);
  });
});

describe('pick', () => {
  it('returns a known option and rejects anything else', () => {
    expect(pick(WEIGHT_OPTIONS, 'fp8_block')).toBe('fp8_block');
    expect(pick(WEIGHT_OPTIONS, 'int4')).toBeNull();
  });
});
