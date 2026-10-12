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

function child(node: HwNode, id: string): HwNode {
  const found = node.children.find((c) => c.id === id);
  if (!found) throw new Error(`${node.id} has no child ${id}`);
  return found;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Levels a click can enter. Task 5.1 adds the GPC and below. */
const ENTERABLE = new Set<PartKind>(['die']);

function part(
  kind: PartKind,
  nodeId: string,
  instance: number,
  position: Vec3,
  size: Vec3,
  enabled = true,
): Placement {
  return {
    key: `${kind}:${nodeId}#${String(instance)}`,
    kind,
    nodeId,
    instance,
    position,
    size,
    enabled,
    enterId: ENTERABLE.has(kind) ? nodeId : null,
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
  const chips: Placement[] = [part('die', die.id, 0, [0, PACKAGE_DIE_Y, 0], PACKAGE_DIE)];
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

/**
 * The SM tiles on top of one GPC (the detail rule of ADR 0017: they look
 * countable, so the count is the tree's). TPCs fill columns left to right;
 * the last `count - enabled` TPCs are the fused-off ones, a `simplified`
 * choice since which TPCs are off varies per chip.
 */
function smTiles(gpc: Placement, variant: HwNode): Placement[] {
  const tpc = variant.children.find((c) => c.level === 'tpc');
  const sm = tpc?.children.find((c) => c.level === 'sm');
  if (!tpc || !sm) throw new Error(`${variant.id} has no TPC with SMs`);
  const tpcs = instances(tpc);
  const perTpc = instances(sm);
  const perGpc = tpcs * perTpc;
  const rows = Math.ceil(tpcs / TPC_COLUMNS) * perTpc;
  const cellW = (gpc.size[0] - 2 * SM_INSET) / TPC_COLUMNS;
  const cellD = (gpc.size[2] - 2 * SM_INSET) / rows;
  const size: Vec3 = [cellW - SM_GAP, SM_HEIGHT, cellD - SM_GAP];
  const y = gpc.position[1] + gpc.size[1] / 2 + SM_HEIGHT / 2;
  return range(perGpc).map((k) => {
    const t = Math.floor(k / perTpc);
    const column = t % TPC_COLUMNS;
    const row = Math.floor(t / TPC_COLUMNS) * perTpc + (k % perTpc);
    const x = gpc.position[0] - gpc.size[0] / 2 + SM_INSET + (column + 0.5) * cellW;
    const z = gpc.position[2] - gpc.size[2] / 2 + SM_INSET + (row + 0.5) * cellD;
    return part('sm', sm.id, gpc.instance * perGpc + k, [x, y, z], size, t < enabledInstances(tpc));
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
      const gpc = part('gpc', variant.id, i, [x, GPC[1] / 2, z], GPC);
      out.push(gpc);
      sms.push(...smTiles(gpc, variant));
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
