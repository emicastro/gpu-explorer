// Camera poses and tween math for level changes (design §6.2). Pure, so the
// flight is testable without a renderer.

export type Vec3 = readonly [number, number, number];

export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** Flight time between levels, in seconds (design §6.2: ~600 ms). */
export const TRANSITION_SECONDS = 0.6;

/** The package seen whole: the only pose in world units, framed for its real size (ADR 0021). */
export const OVERVIEW_POSE: Pose = { position: [2.3, 2.3, 2.3], target: [0, 0, 0] };

/**
 * The resting camera of each level below the package, in the level's own
 * units (ADR 0019): looking at the center of its plate from the front and
 * above. Index 0 is the die; the plates differ in depth, so the farther ones
 * stand back a little.
 */
const LOCAL_VIEWS: readonly Pose[] = [
  { position: [0, 3.4, 3.4], target: [0, 0, 0] },
  { position: [0, 4.6, 4.6], target: [0, 0, 0] },
  { position: [0, 3.2, 3.2], target: [0, 0, 0] },
  { position: [0, 3.8, 3.8], target: [0, 0, 0] },
];

export interface Frame {
  scale: number;
  position: Vec3;
}

/**
 * The resting camera for the level at `depth` whose frame in the world is
 * `frame`. The package (depth 0) ignores the frame.
 */
export function poseForLevel(depth: number, frame: Frame): Pose {
  if (depth <= 0) return OVERVIEW_POSE;
  const local = LOCAL_VIEWS[Math.min(depth, LOCAL_VIEWS.length) - 1] ?? OVERVIEW_POSE;
  const place = (v: Vec3): Vec3 => [
    frame.position[0] + frame.scale * v[0],
    frame.position[1] + frame.scale * v[1],
    frame.position[2] + frame.scale * v[2],
  ];
  return { position: place(local.position), target: place(local.target) };
}

/** Near and far planes that suit a camera `distance` from what it looks at. */
export function clipPlanes(distance: number): { near: number; far: number } {
  return { near: distance * 0.02, far: distance * 200 };
}

/** Sets the planes when they moved by more than 0.1%, and only then rebuilds the projection. */
export function setClipPlanes(
  camera: { near: number; far: number; updateProjectionMatrix: () => void },
  near: number,
  far: number,
): void {
  if (Math.abs(camera.near - near) <= near * 1e-3) return;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
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
