// Camera poses and tween math for level changes (design §6.2). Pure, so the
// flight is testable without a renderer.

export type Vec3 = readonly [number, number, number];

export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** Flight time between levels, in seconds (design §6.2: ~600 ms). */
export const TRANSITION_SECONDS = 0.6;

const POSES: readonly Pose[] = [
  { position: [3, 3, 3], target: [0, 0, 0] },
  { position: [0, 3.4, 3.4], target: [0, 0, 0] },
  { position: [0.5, 0.9, 0.9], target: [0, 0.3, 0] },
  { position: [0.3, 0.6, 0.6], target: [0, 0.3, 0] },
  { position: [0.2, 0.4, 0.4], target: [0, 0.3, 0] },
];

/** The resting camera for a level; deeper than the last pose reuses the last. */
export function poseForDepth(depth: number): Pose {
  return POSES[Math.min(depth, POSES.length - 1)] ?? POSES[0] as Pose;
}

/** Exact at both ends (`a + (b - a) * t` is not at t = 1). */
export const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;

export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  position: lerpVec(a.position, b.position, t),
  target: lerpVec(a.target, b.target, t),
});

/** Ease-in-out cubic on [0, 1]. */
export function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Opacity the siblings of the current level should have at rest: shown at the package, hidden below. */
export const siblingRestOpacity = (depth: number) => (depth === 0 ? 1 : 0);
