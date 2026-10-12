// Every material in the scene is built here (ADR 0017); colors still come only
// from palette.ts. Parts fall into a few surface classes, and each class sets
// how metallic and rough the part looks. Function blocks keep their palette
// color over a semi-metallic base, so color by function survives (brief D13).
import { Color, MeshStandardMaterial } from 'three';
import { partColor, type PartKind } from './palette.ts';
import { detailMaps, type SurfaceDetail } from './textures.ts';

export type SurfaceClass = 'substrate' | 'silicon' | 'metal' | 'contacts' | 'block';

interface Surface {
  metalness: number;
  /** Multiplies the roughness map when the part has surface detail. */
  roughness: number;
}

export const SURFACES: Record<SurfaceClass, Surface> = {
  substrate: { metalness: 0, roughness: 1 },
  silicon: { metalness: 0.35, roughness: 0.55 },
  metal: { metalness: 1, roughness: 0.32 },
  contacts: { metalness: 1, roughness: 0.9 },
  block: { metalness: 0.55, roughness: 0.9 },
};

interface KindLook {
  surface: SurfaceClass;
  /** Surface texture and the size, in the part's units, of one tile of it. */
  detail?: { kind: SurfaceDetail; tile: number };
}

/**
 * How each kind of part looks. Function blocks stay smooth so their color reads
 * at a glance; the grain goes on the silicon around them, as background. Tiles are in the part's own frame: die-level
 * parts live in a frame about 3.5× larger than the package's (layout.ts).
 */
export const KIND_LOOKS: Record<PartKind, KindLook> = {
  substrate: { surface: 'substrate', detail: { kind: 'traces', tile: 1.2 } },
  stiffener: { surface: 'metal' },
  interposer: { surface: 'silicon', detail: { kind: 'bumps', tile: 0.25 } },
  bumps: { surface: 'contacts', detail: { kind: 'bumps', tile: 0.12 } },
  die: { surface: 'silicon', detail: { kind: 'grain', tile: 2.4 } },
  hbm: { surface: 'metal' },
  gpc: { surface: 'block' },
  sm: { surface: 'block' },
  l2: { surface: 'block' },
  'memory-controller': { surface: 'block' },
  gigathread: { surface: 'block' },
  tpc: { surface: 'block' },
  subpartition: { surface: 'block' },
  'l1-shared': { surface: 'block' },
  tma: { surface: 'block' },
  'warp-scheduler': { surface: 'block' },
  'register-file': { surface: 'block' },
  'tensor-core': { surface: 'block' },
  'fp32-core': { surface: 'block' },
  'int32-core': { surface: 'block' },
  'fp64-core': { surface: 'block' },
  'ld-st': { surface: 'block' },
  sfu: { surface: 'block' },
};

/** Disabled parts reflect less of the environment, so they read as off and not just darker. */
const DISABLED_ENV = 0.3;

export interface MaterialSet {
  /** True if `setOpacity` fades this set; only fading sets are transparent. */
  readonly fades: boolean;
  /** The material of a single part, shared by every part of that kind and state in the set. */
  part: (kind: PartKind, enabled: boolean) => MeshStandardMaterial;
  /** The material of an instanced kind: white, so per-instance colors carry the palette. */
  instanced: (kind: PartKind) => MeshStandardMaterial;
  /** Opacity of every material in the set, now and for the ones built later. */
  setOpacity: (opacity: number) => void;
  /** All materials built so far. */
  all: () => MeshStandardMaterial[];
  dispose: () => void;
}

function build(kind: PartKind, color: string, enabled: boolean, fades: boolean): MeshStandardMaterial {
  const look = KIND_LOOKS[kind];
  const surface = SURFACES[look.surface];
  const maps = look.detail ? detailMaps(look.detail.kind, look.detail.tile) : null;
  return new MeshStandardMaterial({
    color: new Color(color),
    metalness: surface.metalness,
    roughness: maps ? surface.roughness : surface.roughness * 0.6,
    envMapIntensity: enabled ? 1 : DISABLED_ENV,
    transparent: fades,
    ...(maps ?? {}),
  });
}

/**
 * A fresh set of materials for one group of parts. A group that fades owns
 * its set, so fading it never touches another group's materials (ADR 0017).
 */
export function createMaterials({ fades }: { fades: boolean }): MaterialSet {
  const cache = new Map<string, MeshStandardMaterial>();
  let opacity = 1;
  const get = (key: string, make: () => MeshStandardMaterial) => {
    let m = cache.get(key);
    if (!m) {
      m = make();
      m.opacity = opacity;
      cache.set(key, m);
    }
    return m;
  };
  return {
    fades,
    part: (kind, enabled) =>
      get(`${kind}:${String(enabled)}`, () => build(kind, partColor(kind, enabled), enabled, fades)),
    instanced: (kind) => get(`${kind}:instanced`, () => build(kind, '#ffffff', true, fades)),
    setOpacity: (o) => {
      if (!fades) throw new Error('this material set does not fade');
      opacity = o;
      for (const m of cache.values()) m.opacity = o;
    },
    all: () => [...cache.values()],
    dispose: () => {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}
