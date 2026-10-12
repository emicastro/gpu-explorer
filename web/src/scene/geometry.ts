// Beveled boxes for every part (ADR 0017). One geometry per distinct size,
// shared by all the parts of that size: a unit box scaled to a flat plate
// would stretch its bevels, so the cache is by size instead.
import type { BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Vec3 } from './layout.ts';

/** Largest bevel radius, in the part's own units. */
const BEVEL = 0.03;
/** Segments per rounded edge; low on purpose (triangle budget, design §6.7). */
const SEGMENTS = 2;

/**
 * Box-projected UVs in the part's own units, so a texture repeats at the same
 * density on every face of every part (textures.ts sets the tile size).
 */
function projectUvs(geometry: BufferGeometry): void {
  const pos = geometry.getAttribute('position');
  const nrm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const [nx, ny, nz] = [Math.abs(nrm.getX(i)), Math.abs(nrm.getY(i)), Math.abs(nrm.getZ(i))];
    if (ny >= nx && ny >= nz) uv.setXY(i, pos.getX(i), pos.getZ(i));
    else if (nx >= nz) uv.setXY(i, pos.getZ(i), pos.getY(i));
    else uv.setXY(i, pos.getX(i), pos.getY(i));
  }
  uv.needsUpdate = true;
}

const cache = new Map<string, BufferGeometry>();

/** The shared beveled box of `size`. Meshes using it must not dispose it (`dispose={null}`). */
export function roundedBox(size: Vec3): BufferGeometry {
  const key = size.join(',');
  const cached = cache.get(key);
  if (cached) return cached;
  const radius = Math.min(BEVEL, Math.min(...size) * 0.25);
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], SEGMENTS, radius);
  projectUvs(geometry);
  cache.set(key, geometry);
  return geometry;
}
