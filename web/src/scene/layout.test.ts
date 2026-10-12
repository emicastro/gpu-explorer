import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardware, initCoreSync, type HwNode } from '../core/index.ts';
import {
  enabledInstances,
  groupParts,
  layoutDie,
  layoutPackage,
  nodeAtLevel,
  type Placement,
} from './layout.ts';
import { PART_COLORS, partColor } from './palette.ts';

let pkg: HwNode;
let die: HwNode;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  const root = hardware('h100-sxm');
  pkg = nodeAtLevel(root, 'package');
  die = nodeAtLevel(root, 'die');
});

const ofKind = (ps: Placement[], kind: Placement['kind']) => ps.filter((p) => p.kind === kind);

describe('layoutPackage', () => {
  it('has 6 HBM sites, 1 of them dimmed, around one die on the interposer', () => {
    const ps = layoutPackage(pkg);
    const hbm = ofKind(ps, 'hbm');
    expect(hbm).toHaveLength(6);
    expect(hbm.filter((p) => !p.enabled)).toHaveLength(1);
    expect(ofKind(ps, 'die')).toHaveLength(1);
    expect(ofKind(ps, 'interposer')).toHaveLength(1);
  });

  it('puts the sites in two columns of three, left and right of the die', () => {
    const hbm = ofKind(layoutPackage(pkg), 'hbm');
    expect(hbm.filter((p) => p.position[0] < 0)).toHaveLength(3);
    expect(hbm.filter((p) => p.position[0] > 0)).toHaveLength(3);
  });

  it('only the die can be entered', () => {
    const entering = layoutPackage(pkg).filter((p) => p.enterId !== null);
    expect(entering.map((p) => p.enterId)).toEqual(['die']);
  });
});

describe('layoutDie', () => {
  const ps = () => layoutDie(die);

  it('has 8 GPCs in two rows of 4, across both variants', () => {
    const gpcs = ofKind(ps(), 'gpc');
    expect(gpcs).toHaveLength(8);
    expect(new Set(gpcs.map((p) => p.position[2])).size).toBe(2);
    expect(new Set(gpcs.map((p) => p.nodeId))).toEqual(new Set(['gpc-8tpc', 'gpc-9tpc']));
  });

  it('has 2 halves of L2 at the center and the GigaThread engine between them', () => {
    const l2 = ofKind(ps(), 'l2');
    expect(l2).toHaveLength(2);
    expect(l2.map((p) => Math.sign(p.position[0])).sort()).toEqual([-1, 1]);
    expect(ofKind(ps(), 'gigathread')).toHaveLength(1);
  });

  it('has 10 enabled memory controllers (12 with the fused-off ones), on the edges', () => {
    const mc = ofKind(ps(), 'memory-controller');
    expect(mc).toHaveLength(12);
    expect(mc.filter((p) => p.enabled)).toHaveLength(10);
    expect(mc.every((p) => Math.abs(p.position[0]) > 1.7)).toBe(true);
  });

  it('keeps every part inside the die plate without overlapping the L2 and the GPC rows', () => {
    const plate = ofKind(ps(), 'die')[0];
    expect(plate).toBeDefined();
    const [w, , d] = plate?.size ?? [0, 0, 0];
    for (const p of ps()) {
      expect(Math.abs(p.position[0]) + p.size[0] / 2).toBeLessThanOrEqual(w / 2);
      expect(Math.abs(p.position[2]) + p.size[2] / 2).toBeLessThanOrEqual(d / 2);
    }
    const l2 = ofKind(ps(), 'l2')[0];
    const gpc = ofKind(ps(), 'gpc')[0];
    const l2Edge = Math.abs(l2?.position[2] ?? 0) + (l2?.size[2] ?? 0) / 2;
    const gpcEdge = Math.abs(gpc?.position[2] ?? 0) - (gpc?.size[2] ?? 0) / 2;
    expect(l2Edge).toBeLessThan(gpcEdge);
  });

  it('disables the controllers of the fused-off HBM site, matching the tree', () => {
    const mc = ofKind(ps(), 'memory-controller');
    const mcNode = die.children.find((c) => c.id === 'memory-controller');
    expect(mc.filter((p) => p.enabled)).toHaveLength(mcNode ? enabledInstances(mcNode) : -1);
    expect(mc.slice(-2).every((p) => !p.enabled)).toBe(true);
  });
});

describe('instancing and palette', () => {
  it('instances only what repeats more than 8 times: the controllers, not the GPCs', () => {
    const groups = groupParts(layoutDie(die));
    expect(groups.instanced.map((g) => g[0]?.kind)).toEqual(['memory-controller']);
    expect(groups.single.filter((p) => p.kind === 'gpc')).toHaveLength(8);
  });

  it('gives each function its own color and dims disabled parts', () => {
    const colors = Object.values(PART_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
    expect(partColor('hbm', true)).toBe(PART_COLORS.hbm);
    expect(partColor('hbm', false)).not.toBe(PART_COLORS.hbm);
  });
});

describe('R19 review checklist', () => {
  it('the repo has no 3D models or images of third parties', () => {
    // Geometry is boxes from layout.ts; nothing is loaded from a file.
    const src = readFileSync(new URL('./layout.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\.(glb|gltf|obj|fbx|png|jpe?g|svg)\b/i);
  });
});
