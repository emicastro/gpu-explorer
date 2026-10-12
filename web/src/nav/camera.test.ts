import { describe, expect, it } from 'vitest';
import { clipPlanes, ease, lerpPose, OVERVIEW_POSE, poseForLevel, siblingRestOpacity, type Frame } from './camera.ts';

const dieFrame: Frame = { scale: 2 / 7, position: [0, 0.25, 0] };

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
    const a = poseForLevel(0, dieFrame);
    const b = poseForLevel(1, dieFrame);
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
    const mid = lerpPose(a, b, 0.5);
    expect(mid.position[0]).toBeCloseTo((a.position[0] + b.position[0]) / 2);
  });

  it('keeps the package pose and puts the die pose where it was before frames', () => {
    expect(poseForLevel(0, dieFrame)).toBe(OVERVIEW_POSE);
    const die = poseForLevel(1, dieFrame);
    expect(die.position[1]).toBeCloseTo(1.22, 2);
    expect(die.position[2]).toBeCloseTo(0.97, 2);
    expect(die.target).toEqual([0, 0.25, 0]);
  });

  it('gets closer to the target at each level, scaling with the frame', () => {
    const dist = (d: number, scale: number) => {
      const { position: p, target: t } = poseForLevel(d, { scale, position: [0, 0, 0] });
      return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
    };
    // Each level's frame is smaller than its parent's.
    const scales = [1, 2 / 7, 0.05, 0.012, 0.004];
    for (let d = 1; d < 5; d++) expect(dist(d, scales[d] ?? 1)).toBeLessThan(dist(d - 1, scales[d - 1] ?? 1));
    expect(dist(2, 1)).toBeCloseTo(2 * dist(2, 0.5));
  });

  it('puts the clip planes in proportion to the distance, so the deepest level is not clipped', () => {
    const deep = poseForLevel(4, { scale: 0.004, position: [0, 0, 0] });
    const d = Math.hypot(...deep.position);
    expect(clipPlanes(d).near).toBeLessThan(d);
    expect(clipPlanes(d).far).toBeGreaterThan(d);
    expect(clipPlanes(10).far / clipPlanes(10).near).toBe(clipPlanes(1).far / clipPlanes(1).near);
  });

  it('shows siblings only at the package', () => {
    expect(siblingRestOpacity(0)).toBe(1);
    expect(siblingRestOpacity(1)).toBe(0);
  });
});
