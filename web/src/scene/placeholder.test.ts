import { describe, expect, it } from 'vitest';
import { BOX_SIZE } from './placeholder.ts';

describe('placeholder scene', () => {
  it('has a positive box size', () => {
    expect(BOX_SIZE).toBeGreaterThan(0);
  });
});
