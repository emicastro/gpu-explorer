// The data flow of one kernel (design §6.6, R11): pure functions from the plan
// and the die layout to particle routes. The scene only draws them.
//
// At the die level the HBM has no geometry: the particles leave from the
// active memory controllers, the HBM's door into the die, cross the L2 half on
// their side and enter a GPC, where the SMs and their tensor cores live (no
// geometry for those until task 5.1). Every GPC gets particles; task 5.3
// narrows them to the SMs the wave occupies.
import type { KernelPlan, Quantity, StepPlan } from '../core/index.ts';
import type { OpKind } from '../generated/OpKind.ts';
import type { Placement, Vec3 } from '../scene/layout.ts';
import type { TrafficClass } from '../scene/palette.ts';

/** The stops of a read, in order. Each leg between two stops takes the same time. */
export const FLOW_STAGES = ['HBM', 'L2', 'SM', 'Tensor core'] as const;

/** The op whose kernel the milestone animates (task 4.4); task 6.2 follows the playhead instead. */
export const FLOW_OP: OpKind = 'qkv_proj';

/** The first kernel that runs `op` in `layer` (null: before and after the layers). */
export function findKernel(plan: StepPlan, op: OpKind, layer: number | null = 0): KernelPlan | null {
  return plan.kernels.find((k) => k.ops.some((o) => o.kind === op && o.layer === layer)) ?? null;
}

// Bytes per kernel span KB to GB (brief §4.3); the scale maps that range to 0..1.
const FLOOR_BYTES = 1e3;
const DECADES = 6;

/** Where `bytes` sits between 1 KB (0) and 1 GB (1), in decades. */
export function logLevel(bytes: number): number {
  if (bytes <= FLOOR_BYTES) return 0;
  return Math.min(Math.log10(bytes / FLOOR_BYTES) / DECADES, 1);
}

export const MIN_PARTICLES = 4;
export const MAX_PARTICLES = 240;

/** Particles for a stream of `bytes`: logarithmic, and at least a few for any traffic. */
export function particleCount(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.round(MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * logLevel(bytes));
}

const MIN_WIDTH = 0.03;
const MAX_WIDTH = 0.16;

/** How wide a stream of `bytes` spreads around its route, in die units. */
export function streamWidth(bytes: number): number {
  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * logLevel(bytes);
}

/** The HBM bytes a kernel reads of one class, drawn as one particle stream. */
export interface Stream {
  cls: TrafficClass;
  bytes: Quantity;
  count: number;
  width: number;
}

const CLASSES: readonly TrafficClass[] = ['weights', 'kv', 'activations'];

/** One stream per class the kernel reads from HBM; classes with no bytes are left out. */
export function flowStreams(kernel: KernelPlan): Stream[] {
  return CLASSES.map((cls) => {
    const bytes = kernel.phaseBreakdown.read[cls];
    return { cls, bytes, count: particleCount(bytes.value), width: streamWidth(bytes.value) };
  }).filter((s) => s.count > 0);
}

/** One stop per entry of `FLOW_STAGES`. */
export type Route = readonly [Vec3, Vec3, Vec3, Vec3];

const top = (p: Placement, lift: number): Vec3 => [
  p.position[0],
  p.position[1] + p.size[1] / 2 + lift,
  p.position[2],
];

/**
 * Every (active controller, GPC) pair, through the L2 half on the controller's
 * side: each controller fills its own half, and any SM reads from either half.
 * The last leg drops from above the GPC into it, toward the tensor cores.
 */
export function flowRoutes(dieParts: Placement[]): Route[] {
  const controllers = dieParts.filter((p) => p.kind === 'memory-controller' && p.enabled);
  const halves = dieParts.filter((p) => p.kind === 'l2');
  const gpcs = dieParts.filter((p) => p.kind === 'gpc');
  const routes: Route[] = [];
  for (const mc of controllers) {
    const half = halves.find((h) => Math.sign(h.position[0]) === Math.sign(mc.position[0]));
    if (!half) throw new Error(`no L2 half on the side of ${mc.key}`);
    for (const gpc of gpcs) {
      routes.push([top(mc, 0.02), top(half, 0.12), top(gpc, 0.35), top(gpc, 0)]);
    }
  }
  return routes;
}

const LEGS = FLOW_STAGES.length - 1;

/** The leg a particle is on at `s` ∈ [0, 1): 0 is HBM → L2, the last is SM → tensor core. */
export function legAt(s: number): number {
  return Math.min(Math.floor(s * LEGS), LEGS - 1);
}

/** Where a particle is at `s` ∈ [0, 1] along `route`. */
export function pointAt(route: Route, s: number): Vec3 {
  const leg = legAt(s);
  const t = s * LEGS - leg;
  const a = route[leg];
  const b = route[leg + 1];
  if (!a || !b) throw new Error(`leg ${String(leg)} is outside the route`);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A particle's size at `s`: full until the last leg, then it shrinks into the GPC. */
export function arrivalScale(s: number): number {
  const leg = legAt(s);
  if (leg < LEGS - 1) return 1;
  return Math.max(1 - (s * LEGS - leg), 0);
}

export interface Particle {
  cls: TrafficClass;
  route: number;
  /** Offset in [0, 1) along the loop, so a stream is spread evenly in time. */
  phase: number;
  /** Fixed displacement from the route, within the stream's width. */
  offset: Vec3;
}

// Low-discrepancy sequences: deterministic and evenly spread, no RNG to seed.
const frac = (x: number): number => x - Math.floor(x);
const R1 = 0.6180339887;
const R2 = 0.7548776662;
const R3 = 0.5698402910;

/** The particles of every stream, each on a route; the same input gives the same output. */
export function flowParticles(streams: Stream[], routes: number): Particle[] {
  if (routes <= 0) return [];
  const out: Particle[] = [];
  let n = 0;
  for (const s of streams) {
    for (let i = 0; i < s.count; i++, n++) {
      out.push({
        cls: s.cls,
        route: Math.floor(frac(n * R1) * routes),
        phase: i / s.count,
        offset: [
          (frac(n * R2) - 0.5) * s.width,
          (frac(n * R3) - 0.5) * s.width * 0.5,
          (frac(n * R1 + 0.5) - 0.5) * s.width,
        ],
      });
    }
  }
  return out;
}

/** The exact byte count, grouped by thousands: `50,339,840 B`. */
export function formatBytes(bytes: number): string {
  return `${Math.round(bytes).toLocaleString('en-US')} B`;
}

const PREFIXES = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** The same count, rounded in decimal units for reading at a glance: `50.3 MB`. */
export function formatBytesShort(bytes: number): string {
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < PREFIXES.length - 1) {
    value /= 1000;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${PREFIXES[i] ?? 'B'}`;
}
