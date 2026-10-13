// The data flow of one kernel (design §6.6, R11): pure functions from the plan
// and the die layout to particle routes. The scene only draws them.
//
// At the die level the HBM has no geometry: the particles leave from the
// active memory controllers, the HBM's door into the die, cross the L2 half on
// their side and land on an SM, where the tensor cores live. They travel in
// pulses, one leg at a time (ADR 0018), and land only on the SMs the current
// wave occupies (ADR 0020).
import type { KernelPlan, Quantity } from '../core/index.ts';
import type { Placement, Vec3 } from '../scene/layout.ts';
import type { TrafficClass } from '../scene/palette.ts';

/** The stops of a read, in order. Each leg between two stops takes the same time. */
export const FLOW_STAGES = ['HBM', 'L2', 'SM', 'Tensor core'] as const;

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

/** Height of the hub above each GPC, where a pulse fans out to its SMs. */
const HUB_LIFT = 0.35;
const L2_LIFT = 0.12;
const MC_LIFT = 0.02;

const insideXZ = (p: Placement, box: Placement): boolean =>
  Math.abs(p.position[0] - box.position[0]) < box.size[0] / 2
  && Math.abs(p.position[2] - box.position[2]) < box.size[2] / 2;

/**
 * Every (active controller, GPC) pair, through the L2 half on the controller's
 * side: each controller fills its own half, and any SM reads from either half.
 * From a hub above the GPC the last leg drops onto one of its enabled SMs,
 * toward the tensor cores (ADR 0018). Controllers take turns over a GPC's SMs,
 * so the landings spread over the GPC.
 *
 * With `busy` (placement keys), only those SMs are landed on, and a GPC with
 * none of them gets no route: the bytes go where the wave's blocks are (ADR 0020).
 */
export function flowRoutes(dieParts: Placement[], busy?: Set<string>): Route[] {
  const controllers = dieParts.filter((p) => p.kind === 'memory-controller' && p.enabled);
  const halves = dieParts.filter((p) => p.kind === 'l2');
  const gpcs = dieParts.filter((p) => p.kind === 'gpc');
  const sms = dieParts.filter((p) => p.kind === 'sm' && p.enabled && (!busy || busy.has(p.key)));
  const routes: Route[] = [];
  controllers.forEach((mc, c) => {
    const half = halves.find((h) => Math.sign(h.position[0]) === Math.sign(mc.position[0]));
    if (!half) throw new Error(`no L2 half on the side of ${mc.key}`);
    for (const gpc of gpcs) {
      const own = sms.filter((sm) => insideXZ(sm, gpc));
      if (busy && own.length === 0) continue;
      const sm = own[(c * 7) % own.length];
      if (!sm) throw new Error(`${gpc.key} has no enabled SM`);
      routes.push([top(mc, MC_LIFT), top(half, L2_LIFT), top(gpc, HUB_LIFT), top(sm, 0)]);
    }
  });
  return routes;
}

/** A straight piece of path, drawn as a line. */
export type Segment = readonly [Vec3, Vec3];

/**
 * The legs the routes share, each drawn once: every active controller to its
 * L2 half, and every L2 half to every GPC's hub. The fan-out onto the SMs is
 * left undrawn: it is short, and the SMs are the target.
 */
export function flowPaths(routes: Route[]): Segment[] {
  const seen = new Set<string>();
  const out: Segment[] = [];
  const add = (a: Vec3, b: Vec3) => {
    const key = `${a.join(',')}>${b.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a, b]);
  };
  for (const [mc, l2, hub] of routes) {
    add(mc, l2);
    add(l2, hub);
  }
  return out;
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

const frac = (x: number): number => x - Math.floor(x);

/**
 * How much of the loop one pulse spans: every particle's phase falls in
 * [0, WAVE_SPREAD), so a pulse travels as one cluster (ADR 0018).
 */
export const WAVE_SPREAD = 0.1;

/** The leg the pulse is on when the loop is at `loop` (any real; only its fraction counts). */
export function waveLeg(loop: number): number {
  return legAt(frac(loop + WAVE_SPREAD / 2));
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
  /** Offset in [0, WAVE_SPREAD) along the loop: its place within the pulse. */
  phase: number;
  /** Fixed displacement from the route, within the stream's width. */
  offset: Vec3;
}

// Low-discrepancy sequences: deterministic and evenly spread, no RNG to seed.
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
        phase: (i / s.count) * WAVE_SPREAD,
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
