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

  it('sits each chip on a micro-bump pad, and the frame on the substrate', () => {
    const ps = layoutPackage(pkg);
    expect(ofKind(ps, 'bumps')).toHaveLength(7);
    expect(ofKind(ps, 'bumps').filter((p) => !p.enabled)).toHaveLength(1);
    expect(ofKind(ps, 'stiffener')).toHaveLength(4);
    expect(ofKind(ps, 'substrate')).toHaveLength(1);
    expect(new Set(ps.map((p) => p.key)).size).toBe(ps.length);
  });

  it('keeps the real proportions: HBM pressed 0.75 mm from the die, all on the interposer (ADR 0021)', () => {
    const ps = layoutPackage(pkg);
    const [dieChip] = ofKind(ps, 'die');
    const [interposer] = ofKind(ps, 'interposer');
    const [substrate] = ofKind(ps, 'substrate');
    if (!dieChip || !interposer || !substrate) throw new Error('missing part');
    // Units per millimetre, from the die's documented area.
    const perMm = Math.sqrt((dieChip.size[0] * dieChip.size[2]) / 814);
    const left = (p: Placement) => p.position[0] - p.size[0] / 2;
    const right = (p: Placement) => p.position[0] + p.size[0] / 2;
    const hbm = ofKind(ps, 'hbm').filter((p) => p.position[0] > 0);
    for (const h of hbm) {
      expect((left(h) - right(dieChip)) / perMm).toBeCloseTo(0.75, 3);
      expect(right(h)).toBeLessThan(right(interposer));
      expect(h.position[1] + h.size[1] / 2).toBeCloseTo(dieChip.position[1] + dieChip.size[1] / 2);
    }
    expect(substrate.size[0] / perMm).toBeCloseTo(58.4, 3);
  });

  it('never overlaps two micro-bump pads', () => {
    const pads = ofKind(layoutPackage(pkg), 'bumps');
    const apart = (a: Placement, b: Placement, axis: 0 | 2) =>
      Math.abs(a.position[axis] - b.position[axis]) >= (a.size[axis] + b.size[axis]) / 2;
    for (const [i, a] of pads.entries())
      for (const b of pads.slice(i + 1)) expect(apart(a, b, 0) || apart(a, b, 2)).toBe(true);
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

  it('draws 144 SMs, 18 on each GPC, with 132 enabled: the tree\'s counts', () => {
    const sms = ofKind(ps(), 'sm');
    expect(sms).toHaveLength(144);
    expect(sms.filter((p) => p.enabled)).toHaveLength(132);
    for (const gpc of ofKind(ps(), 'gpc')) {
      const [gx, , gz] = gpc.position;
      const [gw, , gd] = gpc.size;
      const on = sms.filter((s) => Math.abs(s.position[0] - gx) < gw / 2 && Math.abs(s.position[2] - gz) < gd / 2);
      expect(on).toHaveLength(18);
      // The 8-TPC variant has one TPC (two SMs) fused off.
      expect(on.filter((s) => !s.enabled)).toHaveLength(gpc.nodeId === 'gpc-8tpc' ? 2 : 0);
    }
    expect(new Set(ps().map((p) => p.key)).size).toBe(ps().length);
  });

  it('keeps the SMs inside their GPC and on top of it', () => {
    const gpcs = ofKind(ps(), 'gpc');
    for (const s of ofKind(ps(), 'sm')) {
      const g = gpcs.find((g) => Math.abs(s.position[0] - g.position[0]) < g.size[0] / 2
        && Math.abs(s.position[2] - g.position[2]) < g.size[2] / 2);
      if (!g) throw new Error(`${s.key} is on no GPC`);
      for (const axis of [0, 2] as const) {
        expect(Math.abs(s.position[axis] - g.position[axis]) + s.size[axis] / 2).toBeLessThan(g.size[axis] / 2);
      }
      expect(s.position[1] - s.size[1] / 2).toBeCloseTo(g.position[1] + g.size[1] / 2);
    }
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
  it('instances only what repeats more than 8 times: the SMs and controllers, not the GPCs', () => {
    const groups = groupParts(layoutDie(die));
    expect(groups.instanced.map((g) => g[0]?.kind)).toEqual(['sm', 'memory-controller']);
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
  it('the repo has no 3D models, images or HDRIs of third parties', () => {
    // Geometry is boxes from layout.ts and geometry.ts, textures are generated in
    // textures.ts, and the environment is built in Scene.tsx: nothing is loaded from a file.
    for (const file of ['layout.ts', 'geometry.ts', 'textures.ts', 'materials.ts', 'Scene.tsx', 'Parts.tsx']) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/\.(glb|gltf|obj|fbx|png|jpe?g|svg|webp|ktx2|hdr|exr)\b/i);
      expect(src, file).not.toMatch(/\b(preset|files)=|useLoader|TextureLoader/);
    }
  });
});
