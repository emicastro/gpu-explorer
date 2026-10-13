// Fixed labels per part kind (ADR 0018, design §6.6b): a pure function from a
// level's placements to what each label says and where it sits. The counts
// are the placements', which are the tree's (R8). Visible text is English (R17).
import type { HwNode } from '../core/index.ts';
import type { Confidence } from '../generated/Confidence.ts';
import { worstConfidence } from '../quantity/confidence.ts';
import type { Placement, Vec3 } from './layout.ts';
import type { PartKind } from './palette.ts';

export interface SceneLabel {
  kind: PartKind;
  text: string;
  /** Where the label points, in the level's frame. */
  anchor: Vec3;
  /** The flow stop the label stands for (index into FLOW_STAGES), if any. */
  stop: number | null;
  /**
   * The worst confidence of the counts the label states (ADR 0022); null for a
   * label with no count.
   */
  confidence: Confidence | null;
}

/** The nodes from `root` down to `id`, both included; empty if `id` is not in the tree. */
function pathTo(root: HwNode, id: string): HwNode[] {
  if (root.id === id) return [root];
  for (const c of root.children) {
    const below = pathTo(c, id);
    if (below.length > 0) return [root, ...below];
  }
  return [];
}

/**
 * The confidence of a counted label: the worst of the `count` and `enabled`
 * on the tree path from the level's node down to each counted part's node. The
 * level's node is where the paths of all the level's placements part ways. The
 * path matters: an SM's own `count` is documented, but whether it is on comes
 * from its TPC's `enabled`, which is simplified.
 */
function countConfidence(tree: HwNode, placements: Placement[], parts: Placement[]): Confidence {
  const paths = new Map<string, HwNode[]>();
  const pathOf = (id: string): HwNode[] => {
    let p = paths.get(id);
    if (!p) paths.set(id, (p = pathTo(tree, id)));
    return p;
  };
  const all = placements.map((p) => pathOf(p.nodeId));
  let depth = Math.min(...all.map((p) => p.length));
  for (const p of all) for (let i = 0; i < depth; i++) if (p[i]?.id !== all[0]?.[i]?.id) depth = i;
  const seen: Confidence[] = [];
  for (const part of parts) {
    for (const node of pathOf(part.nodeId).slice(depth)) {
      if (node.count) seen.push(node.count.confidence);
      if (node.enabled) seen.push(node.enabled.confidence);
    }
  }
  return worstConfidence(seen);
}

/** Which part of the kind the label hangs from, and where on it. */
type Anchor = 'first-top' | 'front-most-top' | 'last-front' | 'front-gpc-tiles' | 'front-edge';

interface LabelSpec {
  name: string;
  /** Show `×N (+M off)` after the name. */
  counted: boolean;
  anchor: Anchor;
  stop: number | null;
  /** Extra words after the count. */
  hint?: string;
}

/** Kinds with a label; the others (micro-bumps, the stiffener) don't help reading. */
const SPECS: Partial<Record<PartKind, LabelSpec>> = {
  substrate: { name: 'Substrate', counted: false, anchor: 'front-edge', stop: null },
  interposer: { name: 'Interposer', counted: false, anchor: 'front-edge', stop: null },
  die: { name: 'GH100 die', counted: false, anchor: 'first-top', stop: null },
  hbm: { name: 'HBM3', counted: true, anchor: 'first-top', stop: null },
  gpc: { name: 'GPC', counted: true, anchor: 'last-front', stop: null },
  sm: { name: 'SM', counted: true, anchor: 'front-gpc-tiles', stop: 2 },
  l2: { name: 'L2 cache', counted: false, anchor: 'first-top', stop: 1 },
  'memory-controller': { name: 'Memory controllers', counted: true, anchor: 'front-most-top', stop: 0, hint: '· to HBM' },
  gigathread: { name: 'GigaThread engine', counted: false, anchor: 'first-top', stop: null },
  tpc: { name: 'TPC', counted: true, anchor: 'last-front', stop: null, hint: '· 2 SMs each' },
  subpartition: { name: 'Sub-partition', counted: true, anchor: 'first-top', stop: null },
  'l1-shared': { name: 'L1 / shared memory', counted: false, anchor: 'first-top', stop: null },
  tma: { name: 'TMA', counted: false, anchor: 'first-top', stop: null },
  'warp-scheduler': { name: 'Warp scheduler', counted: false, anchor: 'first-top', stop: null },
  'register-file': { name: 'Register file', counted: false, anchor: 'first-top', stop: null },
  'tensor-core': { name: 'Tensor core', counted: false, anchor: 'first-top', stop: null },
  'fp32-core': { name: 'FP32 cores', counted: true, anchor: 'first-top', stop: null },
  'int32-core': { name: 'INT32 cores', counted: true, anchor: 'first-top', stop: null },
  'fp64-core': { name: 'FP64 cores', counted: true, anchor: 'first-top', stop: null },
  'ld-st': { name: 'Load/store units', counted: true, anchor: 'first-top', stop: null },
  sfu: { name: 'SFU', counted: false, anchor: 'first-top', stop: null },
};

/** `×132 (+12 off)`, or `×8` when all are enabled. */
export function countText(parts: Placement[]): string {
  const off = parts.filter((p) => !p.enabled).length;
  const on = parts.length - off;
  return off > 0 ? `×${String(on)} (+${String(off)} off)` : `×${String(on)}`;
}

const LIFT = 0.04;

/** The part nearest the default camera: largest z, then smallest x. */
function frontMost(parts: Placement[]): Placement | undefined {
  return [...parts].sort((a, b) => b.position[2] - a.position[2] || a.position[0] - b.position[0])[0];
}

const insideXZ = (p: Placement, box: Placement): boolean =>
  Math.abs(p.position[0] - box.position[0]) < box.size[0] / 2
  && Math.abs(p.position[2] - box.position[2]) < box.size[2] / 2;

function anchorOf(parts: Placement[], anchor: Anchor): Vec3 {
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) throw new Error('a label needs at least one part');
  const topOf = (p: Placement): number => p.position[1] + p.size[1] / 2 + LIFT;
  switch (anchor) {
    case 'first-top':
    case 'front-gpc-tiles':
      return [first.position[0], topOf(first), first.position[2]];
    case 'front-most-top': {
      const p = frontMost(parts) ?? first;
      return [p.position[0], topOf(p), p.position[2]];
    }
    case 'last-front':
      return [last.position[0], topOf(last), last.position[2] + last.size[2] / 2];
    case 'front-edge':
      return [first.position[0] - first.size[0] * 0.3, topOf(first), first.position[2] + first.size[2] / 2];
  }
}

/**
 * The labels of one level. Labels sit toward the front of the default view,
 * where they cover less. For SMs the anchor is the middle tile of the
 * front-left GPC, away from the GPC's own label. Parts a click enters say so.
 * `own` is the level's own kind, which gets no label.
 */
export function levelLabels(placements: Placement[], tree: HwNode, own?: PartKind): SceneLabel[] {
  const byKind = new Map<PartKind, Placement[]>();
  for (const p of placements) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const out: SceneLabel[] = [];
  for (const [kind, parts] of byKind) {
    const spec = SPECS[kind];
    // No label for the thing the camera is inside.
    if (!spec || kind === own) continue;
    let anchored = parts;
    if (spec.anchor === 'front-gpc-tiles') {
      // The front-left GPC's tiles, from the middle one on.
      const gpc = frontMost(placements.filter((p) => p.kind === 'gpc'));
      const own = gpc ? parts.filter((p) => insideXZ(p, gpc)) : parts;
      anchored = own.slice(Math.floor(own.length / 2));
    }
    const words = [spec.name];
    if (spec.counted) words.push(countText(parts));
    if (spec.hint) words.push(spec.hint);
    if (parts.some((p) => p.enterId !== null)) words.push('· click to enter');
    out.push({
      kind,
      text: words.join(' '),
      anchor: anchorOf(anchored, spec.anchor),
      stop: spec.stop,
      confidence: spec.counted ? countConfidence(tree, placements, parts) : null,
    });
  }
  return out;
}
