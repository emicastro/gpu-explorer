// Where each level sits in space (ADR 0019). Every level has its own frame:
// its plate is `PLATE_WIDTH` wide in its own units, and the frame places that
// plate over the tile the level was entered from. Pure, so the chain is
// testable without a renderer.
import type { HwNode } from '../core/index.ts';
import {
  DIE_FRAME,
  findNode,
  layoutDie,
  layoutGpc,
  layoutSm,
  layoutSubpartition,
  nodeAtLevel,
  PLATE_WIDTH,
  type Frame,
  type Placement,
  type Vec3,
} from './layout.ts';
import type { PartKind } from './palette.ts';

export const IDENTITY_FRAME: Frame = { scale: 1, position: [0, 0, 0] };

/** `local` (a frame in the parent's units) expressed in the parent's parent. */
export function composeFrames(parent: Frame, local: Frame): Frame {
  const [x, y, z] = local.position;
  const [px, py, pz] = parent.position;
  return {
    scale: parent.scale * local.scale,
    position: [px + parent.scale * x, py + parent.scale * y, pz + parent.scale * z] as Vec3,
  };
}

/** The frame a level takes over `tile`: its plate covers the tile, top on top. */
export function frameOverTile(tile: Placement): Frame {
  const [x, y, z] = tile.position;
  return { scale: tile.size[0] / PLATE_WIDTH, position: [x, y + tile.size[1] / 2, z] };
}

export interface LevelContent {
  placements: Placement[];
  /** The kind of the level's own plate: the thing the camera is inside. */
  own: PartKind;
  /** The level's frame in the world. */
  frame: Frame;
}

/** Kind of the tile a level is entered from, by depth. */
const TILE_KIND: Partial<Record<number, PartKind>> = { 2: 'gpc', 3: 'sm', 4: 'subpartition' };

/**
 * The content of the level at the end of `path` (depth 1 = die … 4 =
 * sub-partition) and its frame in the world. Throws on a path that isn't in
 * the tree, or isn't a chain of tiles that exist.
 */
export function levelContent(root: HwNode, path: string[], picks: number[]): LevelContent {
  if (path.length === 0) throw new Error('the package has no level content; use layoutPackage');
  let frame = DIE_FRAME;
  let placements = layoutDie(nodeAtLevel(root, 'die'));
  let own: PartKind = 'die';
  const variant = path[1] ? findNode(root, path[1]) : null;
  for (let depth = 2; depth <= path.length; depth++) {
    const id = path[depth - 1];
    const kind = TILE_KIND[depth];
    if (id === undefined || kind === undefined || !variant) throw new Error(`no level at depth ${String(depth)}`);
    const instance = picks[depth - 1] ?? 0;
    const tile = placements.find((p) => p.kind === kind && p.nodeId === id && p.instance === instance);
    if (!tile) throw new Error(`no ${kind} ${id}#${String(instance)} to enter`);
    frame = composeFrames(frame, frameOverTile(tile));
    const node = findNode(root, id);
    placements = depth === 2 ? layoutGpc(node)
      : depth === 3 ? layoutSm(variant, node)
        : layoutSubpartition(variant, node);
    own = kind;
  }
  return { placements, own, frame };
}

/** The world frame of the level at the end of the path; the package's is the identity. */
export function levelFrame(root: HwNode, path: string[], picks: number[]): Frame {
  return path.length === 0 ? IDENTITY_FRAME : levelContent(root, path, picks).frame;
}
