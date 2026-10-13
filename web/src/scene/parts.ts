// Parts of the package that are scenery, not nodes of the hardware tree
// (ADR 0025): each has a prose entry in `content/components/` under its id.
import type { HwNode } from '../core/index.ts';
import { findNode } from './layout.ts';

export const EXTRA_PARTS = [
  { id: 'substrate', name: 'Package substrate' },
  { id: 'stiffener', name: 'Stiffener ring' },
  { id: 'interposer', name: 'Silicon interposer' },
  { id: 'bumps', name: 'Micro-bumps' },
] as const;

export const EXTRA_PART_IDS: readonly string[] = EXTRA_PARTS.map((p) => p.id);

/** A node-shaped value for an extra, so the tooltip and panel treat it like any component. */
export function extraNode(id: string): HwNode | null {
  const extra = EXTRA_PARTS.find((p) => p.id === id);
  return extra ? { id, name: extra.name, level: 'unit', specs: {}, contentId: id, children: [] } : null;
}

/** What hover and click on a part explain: a tree node, or one of the extras. */
export function findPart(root: HwNode, id: string): HwNode {
  return extraNode(id) ?? findNode(root, id);
}
