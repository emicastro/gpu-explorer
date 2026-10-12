import { describe, expect, it } from 'vitest';
import { ease, lerpPose, poseForDepth, siblingRestOpacity } from './camera.ts';

describe('camera tween', () => {
  it('eases from 0 to 1, symmetric around the middle, clamped outside', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.25)).toBeLessThan(0.25);
  });

  it('interpolates position and target, ending exactly on the destination', () => {
    const a = poseForDepth(0);
    const b = poseForDepth(1);
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
    const mid = lerpPose(a, b, 0.5);
    expect(mid.position[0]).toBeCloseTo((a.position[0] + b.position[0]) / 2);
  });

  it('gets closer to the target at each level', () => {
    const dist = (d: number) => {
      const { position: p, target: t } = poseForDepth(d);
      return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
    };
    for (let d = 1; d < 5; d++) expect(dist(d)).toBeLessThan(dist(d - 1));
    expect(poseForDepth(99)).toEqual(poseForDepth(4));
  });

  it('shows siblings only at the package', () => {
    expect(siblingRestOpacity(0)).toBe(1);
    expect(siblingRestOpacity(1)).toBe(0);
  });
});
