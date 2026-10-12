// Surface detail generated at startup (ADR 0017): a height field per kind of
// surface, turned into a normal map and a roughness map. Nothing is loaded
// from a file (R19). The detail here is the kind that must not read as
// countable: traces, micro-bumps and logic grain have no count in the tree.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  type Texture,
} from 'three';

export type SurfaceDetail = 'traces' | 'bumps' | 'grain';

/** A tileable height field with a roughness value per texel, both in [0, 1]. */
export interface Field {
  size: number;
  height: Float32Array;
  rough: Float32Array;
}

/** Texels per side; at most 1024 (ADR 0017). Powers of two, so they mipmap and tile. */
const SIZES: Record<SurfaceDetail, number> = { traces: 512, bumps: 256, grain: 512 };

/** Deterministic, so every run (and every screenshot) shows the same surface. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function field(size: number, rough: number): Field {
  return { size, height: new Float32Array(size * size), rough: new Float32Array(size * size).fill(rough) };
}

/** Fills a rectangle, wrapping around the edges so the field tiles. */
function rect(f: Field, x: number, y: number, w: number, h: number, height: number, rough: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = ((y + j) % f.size) * f.size + ((x + i) % f.size);
      f.height[k] = height;
      f.rough[k] = rough;
    }
  }
}

/** Substrate routing: Manhattan traces on a channel grid, with a via at each end. */
function traces(): Field {
  const f = field(SIZES.traces, 0.78);
  const rnd = random(1);
  const PITCH = 8;
  const channels = f.size / PITCH;
  for (let n = 0; n < 260; n++) {
    const horizontal = rnd() < 0.5;
    const lane = Math.floor(rnd() * channels) * PITCH;
    const start = Math.floor(rnd() * f.size);
    const length = 24 + Math.floor(rnd() * 160);
    if (horizontal) rect(f, start, lane, length, 3, 0.7, 0.35);
    else rect(f, lane, start, 3, length, 0.7, 0.35);
    const [ex, ey] = horizontal ? [start + length - 2, lane - 1] : [lane - 1, start + length - 2];
    rect(f, ex, ey, 5, 5, 1, 0.3);
  }
  return f;
}

/** The interposer's micro-bump field: a dense grid of domes, far too many to count. */
function bumps(): Field {
  const f = field(SIZES.bumps, 0.62);
  const PITCH = 8;
  const RADIUS = 2.8;
  for (let y = 0; y < f.size; y++) {
    for (let x = 0; x < f.size; x++) {
      const dx = (x % PITCH) - PITCH / 2 + 0.5;
      const dy = (y % PITCH) - PITCH / 2 + 0.5;
      const r = Math.hypot(dx, dy) / RADIUS;
      if (r < 1) {
        const k = y * f.size + x;
        f.height[k] = Math.sqrt(1 - r * r);
        f.rough[k] = 0.22;
      }
    }
  }
  return f;
}

/** Logic grain: rows of standard cells of random widths, with a few SRAM-like macros. */
function grain(): Field {
  const f = field(SIZES.grain, 0.5);
  const rnd = random(2);
  const ROW = 10;
  for (let y = 0; y < f.size; y += ROW) {
    let x = 0;
    while (x < f.size) {
      const w = 4 + Math.floor(rnd() * 24);
      const h = 0.25 + rnd() * 0.6;
      rect(f, x, y, Math.min(w, f.size - x), ROW - 2, h, 0.4 + rnd() * 0.2);
      x += w + 2;
    }
  }
  for (let n = 0; n < 6; n++) {
    const x0 = Math.floor(rnd() * f.size);
    const y0 = Math.floor(rnd() * f.size);
    const w = 40 + Math.floor(rnd() * 60);
    const h = 30 + Math.floor(rnd() * 40);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const lit = (i % 6 < 3) !== (j % 6 < 3);
        rect(f, x0 + i, y0 + j, 1, 1, lit ? 0.9 : 0.5, lit ? 0.2 : 0.4);
      }
    }
  }
  return f;
}

const BUILDERS: Record<SurfaceDetail, () => Field> = { traces, bumps, grain };

export function buildField(detail: SurfaceDetail): Field {
  return BUILDERS[detail]();
}

/**
 * Tangent-space normals from the height field's slopes (RGB), with the roughness
 * in G of a second texture: three.js reads `roughnessMap` from G.
 */
export function encodeField(f: Field, strength: number): { normal: Uint8Array; rough: Uint8Array } {
  const { size, height } = f;
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      normal[k] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      normal[k + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      normal[k + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normal[k + 3] = 255;
      const r = Math.round((f.rough[y * size + x] ?? 0) * 255);
      rough[k] = r;
      rough[k + 1] = r;
      rough[k + 2] = r;
      rough[k + 3] = 255;
    }
  }
  return { normal, rough };
}

export interface DetailMaps {
  normalMap: Texture;
  roughnessMap: Texture;
}

function texture(data: Uint8Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Slope gain when encoding normals: how deep the relief looks. */
const STRENGTH: Record<SurfaceDetail, number> = { traces: 2, bumps: 3, grain: 0.35 };

const base = new Map<SurfaceDetail, DetailMaps>();
const tiled = new Map<string, DetailMaps>();

/**
 * The maps of `detail`, repeating every `tile` units of the geometry's UVs
 * (which are in the part's own units, see geometry.ts). Generated once per
 * detail; each tile size is a clone that shares the uploaded image.
 */
export function detailMaps(detail: SurfaceDetail, tile: number): DetailMaps {
  const key = `${detail}@${String(tile)}`;
  const cached = tiled.get(key);
  if (cached) return cached;
  let maps = base.get(detail);
  if (!maps) {
    const f = buildField(detail);
    const { normal, rough } = encodeField(f, STRENGTH[detail]);
    maps = { normalMap: texture(normal, f.size), roughnessMap: texture(rough, f.size) };
    base.set(detail, maps);
  }
  const out: DetailMaps = { normalMap: maps.normalMap.clone(), roughnessMap: maps.roughnessMap.clone() };
  out.normalMap.repeat.set(1 / tile, 1 / tile);
  out.roughnessMap.repeat.set(1 / tile, 1 / tile);
  tiled.set(key, out);
  return out;
}
