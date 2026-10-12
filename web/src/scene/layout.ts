// Procedural layouts of the package and the die (design §6.3, R8). Pure
// functions from the hardware tree to boxes: the counts come from the tree,
// the positions are a `simplified` sketch of the real floorplan. All
// geometry is our own (R19): no third-party models or images.
import type { HwNode } from '../core/index.ts';
import type { PartKind } from './palette.ts';

export type Vec3 = readonly [number, number, number];

export interface Placement {
  /** Unique within one layout. */
  key: string;
  kind: PartKind;
  /** The hardware-tree node this instance comes from. */
  nodeId: string;
  /** Index among the instances of that node, in the layout's own order. */
  instance: number;
  position: Vec3;
  size: Vec3;
  /** False for instances the chip has fused off; they are drawn dimmed. */
  enabled: boolean;
  /** The node id a click enters, or null if this part is not navigable (yet). */
  enterId: string | null;
}

/** Instances of a node in its parent. */
export const instances = (node: HwNode): number => Math.round(node.count?.value ?? 1);

/** Instances that are enabled; the last ones are the fused-off ones. */
export const enabledInstances = (node: HwNode): number =>
  Math.round(node.enabled?.value ?? instances(node));

/** First node at `level` in depth-first order. Throws if the tree has none. */
export function nodeAtLevel(root: HwNode, level: HwNode['level']): HwNode {
  if (root.level === level) return root;
  for (const child of root.children) {
    try {
      return nodeAtLevel(child, level);
    } catch {
      // not in this subtree
    }
  }
  throw new Error(`hardware tree has no ${level} node`);
}

/** The node with this id; ids are unique across the tree. */
export function findNode(root: HwNode, id: string): HwNode {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNodeOrNull(c, id);
    if (found) return found;
  }
  throw new Error(`hardware tree has no node ${id}`);
}

function findNodeOrNull(root: HwNode, id: string): HwNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const found = findNodeOrNull(c, id);
    if (found) return found;
  }
  return null;
}

function child(node: HwNode, id: string): HwNode {
  const found = node.children.find((c) => c.id === id);
  if (!found) throw new Error(`${node.id} has no child ${id}`);
  return found;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** A level's frame in its parent's: uniform scale, then translation (ADR 0019). */
export type { Frame } from '../nav/camera.ts';

/** Every level's plate is this wide in its own units; the depth follows the tile it covers. */
export const PLATE_WIDTH = 4.2;

function part(
  kind: PartKind,
  nodeId: string,
  instance: number,
  position: Vec3,
  size: Vec3,
  enabled = true,
  enterable = false,
): Placement {
  return {
    key: `${kind}:${nodeId}#${String(instance)}`,
    kind,
    nodeId,
    instance,
    position,
    size,
    enabled,
    enterId: enterable ? nodeId : null,
  };
}

/** The HBM sites sit in two columns of three on the sides of the die. */
const HBM_ROWS = 3;

/** The die level's own frame: its plate, in die-level units (see `layoutDie`). */
const DIE_PLATE: Vec3 = [4.2, 0.1, 3.9];
/** The die on the package: same footprint as the die level's plate, scaled down. */
const PACKAGE_DIE_WIDTH = 1.2;
const PACKAGE_DIE: Vec3 = [PACKAGE_DIE_WIDTH, 0.3, (PACKAGE_DIE_WIDTH * DIE_PLATE[2]) / DIE_PLATE[0]];
const PACKAGE_DIE_Y = 0.1;

/**
 * Where the die level sits in the package's frame: scaled so its plate covers
 * the package's die, with the plate's top on the die's top. The landing then
 * swaps one die for the other without a jump in size.
 */
export const DIE_FRAME = {
  scale: PACKAGE_DIE_WIDTH / DIE_PLATE[0],
  position: [0, PACKAGE_DIE_Y + PACKAGE_DIE[1] / 2, 0] as Vec3,
};

/** How far the gold micro-bump fringe shows around a chip on the interposer. */
const BUMP_FRINGE = 0.04;
const INTERPOSER_TOP = -0.05;

/** A chip's micro-bump pad: under it on the interposer, a little wider, never clickable. */
function bumpPad(chip: Placement): Placement {
  const [x, , z] = chip.position;
  const [w, , d] = chip.size;
  return part('bumps', chip.nodeId, chip.instance, [x, INTERPOSER_TOP + 0.006, z],
    [w + 2 * BUMP_FRINGE, 0.012, d + 2 * BUMP_FRINGE], chip.enabled);
}

const SUBSTRATE: Vec3 = [4, 0.12, 3.2];
const STIFFENER_WIDTH = 0.12;
const STIFFENER_HEIGHT = 0.06;

/**
 * Package: the substrate with its metal stiffener frame, the interposer on it,
 * and on the interposer the die at the center and the HBM sites around it.
 * The substrate, the frame and the bump pads are not tree nodes; they carry
 * the package's id.
 */
export function layoutPackage(pkg: HwNode): Placement[] {
  const die = child(pkg, 'die');
  const hbm = child(pkg, 'hbm-site');
  const sites = instances(hbm);
  const active = enabledInstances(hbm);
  const substrateTop = INTERPOSER_TOP - 0.1;
  const frameY = substrateTop + STIFFENER_HEIGHT / 2;
  const [sw, , sd] = SUBSTRATE;
  const out: Placement[] = [
    part('substrate', pkg.id, 0, [0, substrateTop - SUBSTRATE[1] / 2, 0], SUBSTRATE),
    part('stiffener', pkg.id, 0, [0, frameY, -(sd - STIFFENER_WIDTH) / 2], [sw, STIFFENER_HEIGHT, STIFFENER_WIDTH]),
    part('stiffener', pkg.id, 1, [0, frameY, (sd - STIFFENER_WIDTH) / 2], [sw, STIFFENER_HEIGHT, STIFFENER_WIDTH]),
    part('stiffener', pkg.id, 2, [-(sw - STIFFENER_WIDTH) / 2, frameY, 0], [STIFFENER_WIDTH, STIFFENER_HEIGHT, sd - 2 * STIFFENER_WIDTH]),
    part('stiffener', pkg.id, 3, [(sw - STIFFENER_WIDTH) / 2, frameY, 0], [STIFFENER_WIDTH, STIFFENER_HEIGHT, sd - 2 * STIFFENER_WIDTH]),
    part('interposer', pkg.id, 0, [0, INTERPOSER_TOP - 0.05, 0], [3, 0.1, 2.2]),
  ];
  const chips: Placement[] = [part('die', die.id, 0, [0, PACKAGE_DIE_Y, 0], PACKAGE_DIE, true, true)];
  for (const i of range(sites)) {
    const column = Math.floor(i / HBM_ROWS);
    const row = i % HBM_ROWS;
    const x = column === 0 ? -1.1 : 1.1;
    const z = (row - (HBM_ROWS - 1) / 2) * 0.68;
    chips.push(part('hbm', hbm.id, i, [x, 0.05, z], [0.4, 0.2, 0.6], i < active));
  }
  return [...out, ...chips.map(bumpPad), ...chips];
}

const GPCS_PER_ROW = 4;
const GPC: Vec3 = [0.7, 0.12, 0.9];

/** TPCs of a GPC, in columns; each TPC is its two SMs, one behind the other. */
const TPC_COLUMNS = 3;
const SM_INSET = 0.04;
const SM_GAP = 0.025;
const SM_HEIGHT = 0.06;

function gpcParts(variant: HwNode) {
  const tpc = variant.children.find((c) => c.level === 'tpc');
  const sm = tpc?.children.find((c) => c.level === 'sm');
  if (!tpc || !sm) throw new Error(`${variant.id} has no TPC with SMs`);
  return { tpc, sm };
}

/** The grid the SMs of a GPC sit on, in units where the GPC tile is `GPC` times `k`. */
function smGrid(variant: HwNode, k: number) {
  const { tpc, sm } = gpcParts(variant);
  const tpcs = instances(tpc);
  const perTpc = instances(sm);
  const rows = Math.ceil(tpcs / TPC_COLUMNS) * perTpc;
  const cellW = (GPC[0] * k - 2 * SM_INSET * k) / TPC_COLUMNS;
  const cellD = (GPC[2] * k - 2 * SM_INSET * k) / rows;
  return { tpc, sm, tpcs, perTpc, rows, cellW, cellD, size: [cellW - SM_GAP * k, SM_HEIGHT * k, cellD - SM_GAP * k] as Vec3 };
}

/**
 * The SM tiles on top of one GPC plate scaled by `k` (the detail rule of ADR
 * 0017: they look countable, so the count is the tree's). TPCs fill columns
 * left to right; the last `count - enabled` TPCs are the fused-off ones, a
 * `simplified` choice since which TPCs are off varies per chip. `instance` of
 * a tile is `base` plus its index. At the GPC level the SMs are clickable.
 */
function smTiles(gpc: Placement, variant: HwNode, k: number, base: number, enterable: boolean): Placement[] {
  const { sm, tpc, perTpc, tpcs, cellW, cellD, size } = smGrid(variant, k);
  const y = gpc.position[1] + gpc.size[1] / 2 + SM_HEIGHT * k / 2;
  return range(tpcs * perTpc).map((n) => {
    const t = Math.floor(n / perTpc);
    const column = t % TPC_COLUMNS;
    const row = Math.floor(t / TPC_COLUMNS) * perTpc + (n % perTpc);
    const x = gpc.position[0] - gpc.size[0] / 2 + SM_INSET * k + (column + 0.5) * cellW;
    const z = gpc.position[2] - gpc.size[2] / 2 + SM_INSET * k + (row + 0.5) * cellD;
    const on = t < enabledInstances(tpc);
    return part('sm', sm.id, base + n, [x, y, z], size, on, enterable && on);
  });
}

/**
 * Die, in its own frame (`DIE_PLATE`, about 4 × 4; `DIE_FRAME` places it on
 * the package): two rows of GPCs with their SMs, the L2 in two halves between
 * them, the GigaThread engine in the middle, and the memory controllers on the
 * left and right edges next to the HBM they serve (two per site, in the same
 * order, so the fused-off site's pair is the last two).
 */
export function layoutDie(die: HwNode): Placement[] {
  const l2 = child(die, 'l2');
  const controllers = child(die, 'memory-controller');
  const giga = child(die, 'gigathread-engine');
  const out: Placement[] = [part('die', die.id, 0, [0, -DIE_PLATE[1] / 2, 0], DIE_PLATE)];

  // The GPC variants are separate nodes (ADR 0008); lay them out in one sequence.
  const gpcs = die.children.filter((c) => c.level === 'gpc');
  const sms: Placement[] = [];
  let slot = 0;
  for (const variant of gpcs) {
    for (const i of range(instances(variant))) {
      const column = slot % GPCS_PER_ROW;
      const row = Math.floor(slot / GPCS_PER_ROW);
      const x = (column - (GPCS_PER_ROW - 1) / 2) * 0.8;
      const z = row === 0 ? -1.2 : 1.2;
      const gpc = part('gpc', variant.id, i, [x, GPC[1] / 2, z], GPC, true, true);
      out.push(gpc);
      const grid = smGrid(variant, 1);
      sms.push(...smTiles(gpc, variant, 1, i * grid.tpcs * grid.perTpc, false));
      slot++;
    }
  }
  out.push(...sms);

  for (const i of range(instances(l2))) {
    const x = i === 0 ? -1 : 1;
    out.push(part('l2', l2.id, i, [x, 0.08, 0], [1.4, 0.16, 0.5]));
  }
  out.push(part('gigathread', giga.id, 0, [0, 0.08, 0], [0.4, 0.16, 0.5]));

  const total = instances(controllers);
  const enabled = enabledInstances(controllers);
  const perSide = total / 2;
  for (const i of range(total)) {
    const side = i < perSide ? -1 : 1;
    const row = i % perSide;
    const z = (row - (perSide - 1) / 2) * 0.6;
    out.push(part('memory-controller', controllers.id, i, [side * 1.85, 0.06, z], [0.2, 0.12, 0.45], i < enabled));
  }
  return out;
}

/** The GPC level's plate is the die level's GPC tile scaled up to the common plate width. */
const GPC_K = PLATE_WIDTH / GPC[0];
const GPC_PLATE: Vec3 = [GPC[0] * GPC_K, GPC[1] * GPC_K, GPC[2] * GPC_K];
/** SM and sub-partition plates are thin slabs; only their top surface and footprint matter. */
const SLAB = 0.3;

/**
 * One GPC, in its own frame: its TPCs as slabs, two SMs on each. The SMs
 * (the enabled ones) are what a click enters, and the TPC is the physical pair
 * the SMs share (the tree has the TPC level; navigation skips it).
 */
export function layoutGpc(variant: HwNode): Placement[] {
  const grid = smGrid(variant, GPC_K);
  const plate = part('gpc', variant.id, 0, [0, -GPC_PLATE[1] / 2, 0], GPC_PLATE);
  const slabHeight = SM_HEIGHT * GPC_K * 0.5;
  const slabs = range(grid.tpcs).map((t) => {
    const column = t % TPC_COLUMNS;
    const row = Math.floor(t / TPC_COLUMNS) * grid.perTpc + (grid.perTpc - 1) / 2;
    const x = -GPC_PLATE[0] / 2 + SM_INSET * GPC_K + (column + 0.5) * grid.cellW;
    const z = -GPC_PLATE[2] / 2 + SM_INSET * GPC_K + (row + 0.5) * grid.cellD;
    const rim = SM_GAP * GPC_K * 0.3;
    return part('tpc', grid.tpc.id, t, [x, slabHeight / 2, z],
      [grid.cellW - rim, slabHeight, grid.cellD * grid.perTpc - rim], t < enabledInstances(grid.tpc));
  });
  return [plate, ...slabs, ...smTiles(plate, variant, GPC_K, 0, true)];
}

const LEVEL_INSET = 0.15;
const LEVEL_GAP = 0.1;
const SM_SIDE_COLUMN = 1;
const SUBPARTITION_COLUMNS = 2;

/** The SM's plate and the sub-partition tile on it, from the SM tile at the GPC level. */
function smDims(variant: HwNode) {
  const tile = smGrid(variant, 1).size;
  const plate: Vec3 = [PLATE_WIDTH, SLAB, (PLATE_WIDTH * tile[2]) / tile[0]];
  const leftW = PLATE_WIDTH - 2 * LEVEL_INSET - LEVEL_GAP - SM_SIDE_COLUMN;
  const sub: Vec3 = [
    (leftW - LEVEL_GAP) / SUBPARTITION_COLUMNS,
    0.35,
    (plate[2] - 2 * LEVEL_INSET - LEVEL_GAP) / 2,
  ];
  return { plate, sub };
}

/** The unit under `parent` whose id ends in `/name`. */
function unit(parent: HwNode, name: string): HwNode {
  const found = parent.children.find((c) => c.id.endsWith(`/${name}`));
  if (!found) throw new Error(`${parent.id} has no ${name}`);
  return found;
}

/**
 * One SM, in its own frame: its sub-partitions in a 2 × 2 block on the left,
 * and on the right the L1 / shared memory and the TMA, which belong to the SM
 * and not to any one sub-partition.
 */
export function layoutSm(variant: HwNode, sm: HwNode): Placement[] {
  const { plate, sub } = smDims(variant);
  const subpartition = sm.children.find((c) => c.level === 'subpartition');
  if (!subpartition) throw new Error(`${sm.id} has no sub-partition`);
  const out: Placement[] = [part('sm', sm.id, 0, [0, -SLAB / 2, 0], plate)];
  const left = -plate[0] / 2 + LEVEL_INSET;
  const back = -plate[2] / 2 + LEVEL_INSET;
  for (const i of range(instances(subpartition))) {
    const c = i % SUBPARTITION_COLUMNS;
    const r = Math.floor(i / SUBPARTITION_COLUMNS);
    out.push(part('subpartition', subpartition.id, i,
      [left + (c + 0.5) * sub[0] + c * LEVEL_GAP, sub[1] / 2, back + (r + 0.5) * sub[2] + r * LEVEL_GAP],
      sub, true, true));
  }
  const sideX = plate[0] / 2 - LEVEL_INSET - SM_SIDE_COLUMN / 2;
  const sideDepth = plate[2] - 2 * LEVEL_INSET;
  const l1Depth = (sideDepth - LEVEL_GAP) * 0.68;
  const tmaDepth = sideDepth - LEVEL_GAP - l1Depth;
  out.push(part('l1-shared', unit(sm, 'l1-shared').id, 0, [sideX, 0.15, back + l1Depth / 2],
    [SM_SIDE_COLUMN, 0.3, l1Depth]));
  out.push(part('tma', unit(sm, 'tma').id, 0, [sideX, 0.15, back + l1Depth + LEVEL_GAP + tmaDepth / 2],
    [SM_SIDE_COLUMN, 0.3, tmaDepth]));
  return out;
}

const CORE_COLUMNS = 8;
const CORE_HEIGHT = 0.12;
const CORE_FILL = 0.78;

/** The sub-partition's plate: the sub-partition tile of the SM level, scaled to the plate width. */
function subPlate(variant: HwNode): Vec3 {
  const { sub } = smDims(variant);
  return [PLATE_WIDTH, SLAB, (PLATE_WIDTH * sub[2]) / sub[0]];
}

/**
 * One sub-partition, in its own frame: the warp scheduler (and SFU), the
 * register file and the tensor core as blocks, and below them the CUDA cores
 * as grids, one square per core with the tree's counts. The warp itself is
 * not here: it is a group of 32 threads, not a block of silicon (brief §4.1).
 */
export function layoutSubpartition(variant: HwNode, sub: HwNode): Placement[] {
  const plate = subPlate(variant);
  const out: Placement[] = [part('subpartition', sub.id, 0, [0, -SLAB / 2, 0], plate)];
  const usableW = plate[0] - 2 * LEVEL_INSET;
  const x0 = -plate[0] / 2 + LEVEL_INSET;
  const z0 = -plate[2] / 2 + LEVEL_INSET;
  const block = (kind: PartKind, name: string, x: number, z: number, w: number, d: number, h: number) => {
    const node = unit(sub, name);
    out.push(part(kind, node.id, 0, [x0 + x + w / 2, h / 2, z0 + z + d / 2], [w, h, d]));
  };
  const bandA = 0.5;
  const bandB = 1.1;
  const sfuW = 1.2;
  block('warp-scheduler', 'warp-scheduler', 0, 0, usableW - sfuW - LEVEL_GAP, bandA, 0.25);
  block('sfu', 'sfu', usableW - sfuW, 0, sfuW, bandA, 0.25);
  const bandBZ = bandA + LEVEL_GAP;
  const regW = 1.5;
  block('register-file', 'register-file', 0, bandBZ, regW, bandB, 0.3);
  block('tensor-core', 'tensor-core', regW + LEVEL_GAP, bandBZ, usableW - regW - LEVEL_GAP, bandB, 0.4);

  const coresZ = bandBZ + bandB + LEVEL_GAP;
  const coresD = plate[2] - 2 * LEVEL_INSET - coresZ;
  const half = (usableW - LEVEL_GAP) / 2;
  const cores = (kind: PartKind, name: string, x: number, z: number, rowPitch: number) => {
    const node = unit(sub, name);
    const n = instances(node);
    const pitchX = half / CORE_COLUMNS;
    const size: Vec3 = [pitchX * CORE_FILL, CORE_HEIGHT, rowPitch * CORE_FILL];
    for (const i of range(n)) {
      const c = i % CORE_COLUMNS;
      const r = Math.floor(i / CORE_COLUMNS);
      out.push(part(kind, node.id, i,
        [x0 + x + (c + 0.5) * pitchX, CORE_HEIGHT / 2, z0 + z + (r + 0.5) * rowPitch], size));
    }
    return Math.ceil(n / CORE_COLUMNS);
  };
  const fp32 = unit(sub, 'fp32-core');
  cores('fp32-core', 'fp32-core', 0, coresZ, coresD / Math.ceil(instances(fp32) / CORE_COLUMNS));
  const rightRows = ['int32-core', 'fp64-core', 'ld-st'].reduce((n, name) => n + Math.ceil(instances(unit(sub, name)) / CORE_COLUMNS), 0);
  const rowPitch = coresD / rightRows;
  let z = coresZ;
  for (const [kind, name] of [['int32-core', 'int32-core'], ['fp64-core', 'fp64-core'], ['ld-st', 'ld-st']] as const) {
    z += cores(kind, name, half + LEVEL_GAP, z, rowPitch) * rowPitch;
  }
  return out;
}

/** A kind drawn as one instanced mesh once it repeats more than this (design §6.3). */
export const INSTANCING_THRESHOLD = 8;

export interface PartGroups {
  /** Kinds that repeat enough to share one mesh. */
  instanced: Placement[][];
  single: Placement[];
}

export function groupParts(placements: Placement[]): PartGroups {
  const byKind = new Map<PartKind, Placement[]>();
  for (const p of placements) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const groups: PartGroups = { instanced: [], single: [] };
  for (const list of byKind.values()) {
    if (list.length > INSTANCING_THRESHOLD) groups.instanced.push(list);
    else groups.single.push(...list);
  }
  return groups;
}
