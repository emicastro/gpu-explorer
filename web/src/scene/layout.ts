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
  node: HwNode,
  instance: number,
  position: Vec3,
  size: Vec3,
  enabled = true,
): Placement {
  return {
    key: `${node.id}#${String(instance)}`,
    kind,
    nodeId: node.id,
    instance,
    position,
    size,
    enabled,
    enterId: ENTERABLE.has(kind) ? node.id : null,
  };
}

/** The HBM sites sit in two columns of three on the sides of the die. */
const HBM_ROWS = 3;

/** Package: the interposer, the die at the center and the HBM sites around it. */
export function layoutPackage(pkg: HwNode): Placement[] {
  const die = child(pkg, 'die');
  const hbm = child(pkg, 'hbm-site');
  const sites = instances(hbm);
  const active = enabledInstances(hbm);
  const out: Placement[] = [
    part('interposer', pkg, 0, [0, -0.1, 0], [3, 0.1, 2.2]),
    part('die', die, 0, [0, 0.1, 0], [1.2, 0.3, 1.2]),
  ];
  for (const i of range(sites)) {
    const column = Math.floor(i / HBM_ROWS);
    const row = i % HBM_ROWS;
    const x = column === 0 ? -1.1 : 1.1;
    const z = (row - (HBM_ROWS - 1) / 2) * 0.68;
    out.push(part('hbm', hbm, i, [x, 0.05, z], [0.4, 0.2, 0.6], i < active));
  }
  return out;
}

const GPCS_PER_ROW = 4;

/**
 * Die, in its own normalized frame (about 4 × 4): two rows of GPCs, the L2 in
 * two halves between them, the GigaThread engine in the middle, and the memory
 * controllers on the left and right edges next to the HBM they serve (two per
 * site, in the same order, so the fused-off site's pair is the last two).
 */
export function layoutDie(die: HwNode): Placement[] {
  const l2 = child(die, 'l2');
  const controllers = child(die, 'memory-controller');
  const giga = child(die, 'gigathread-engine');
  const out: Placement[] = [part('die', die, 0, [0, -0.05, 0], [4.2, 0.1, 3.9])];

  // The GPC variants are separate nodes (ADR 0008); lay them out in one sequence.
  const gpcs = die.children.filter((c) => c.level === 'gpc');
  let slot = 0;
  for (const variant of gpcs) {
    for (const i of range(instances(variant))) {
      const column = slot % GPCS_PER_ROW;
      const row = Math.floor(slot / GPCS_PER_ROW);
      const x = (column - (GPCS_PER_ROW - 1) / 2) * 0.8;
      const z = row === 0 ? -1.2 : 1.2;
      out.push(part('gpc', variant, i, [x, 0.1, z], [0.7, 0.2, 0.9]));
      slot++;
    }
  }

  for (const i of range(instances(l2))) {
    const x = i === 0 ? -1 : 1;
    out.push(part('l2', l2, i, [x, 0.08, 0], [1.4, 0.16, 0.5]));
  }
  out.push(part('gigathread', giga, 0, [0, 0.08, 0], [0.4, 0.16, 0.5]));

  const total = instances(controllers);
  const enabled = enabledInstances(controllers);
  const perSide = total / 2;
  for (const i of range(total)) {
    const side = i < perSide ? -1 : 1;
    const row = i % perSide;
    const z = (row - (perSide - 1) / 2) * 0.6;
    out.push(part('memory-controller', controllers, i, [side * 1.85, 0.06, z], [0.2, 0.12, 0.45], i < enabled));
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
