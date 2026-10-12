import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardware, initCoreSync, type HwNode } from '../core/index.ts';
import { levelContent, levelFrame } from './frames.ts';
import {
  DIE_FRAME,
  findNode,
  groupParts,
  layoutDie,
  layoutGpc,
  layoutSm,
  layoutSubpartition,
  nodeAtLevel,
  type Placement,
} from './layout.ts';

let root: HwNode;
let die: HwNode;
const GPC8 = 'gpc-8tpc';
const GPC9 = 'gpc-9tpc';
const SM = (g: string) => `${g}/tpc/sm`;
const SUB = (g: string) => `${SM(g)}/subpartition`;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  root = hardware('h100-sxm');
  die = nodeAtLevel(root, 'die');
});

const ofKind = (ps: Placement[], kind: Placement['kind']) => ps.filter((p) => p.kind === kind);
const plateOf = (ps: Placement[]) => {
  const plate = ps[0];
  if (!plate) throw new Error('empty layout');
  return plate;
};

describe('layoutGpc', () => {
  it('has 9 TPCs and 18 SMs; the 8-TPC variant has one TPC (two SMs) off', () => {
    const eight = layoutGpc(findNode(root, GPC8));
    expect(ofKind(eight, 'tpc')).toHaveLength(9);
    expect(ofKind(eight, 'tpc').filter((p) => !p.enabled)).toHaveLength(1);
    expect(ofKind(eight, 'sm')).toHaveLength(18);
    expect(ofKind(eight, 'sm').filter((p) => !p.enabled)).toHaveLength(2);
    const nine = layoutGpc(findNode(root, GPC9));
    expect(ofKind(nine, 'sm').filter((p) => !p.enabled)).toHaveLength(0);
  });

  it('lets a click enter the enabled SMs only, each with its own instance', () => {
    const sms = ofKind(layoutGpc(findNode(root, GPC8)), 'sm');
    expect(sms.filter((p) => p.enterId !== null)).toHaveLength(16);
    expect(sms.filter((p) => p.enterId !== null).every((p) => p.enterId === SM(GPC8))).toBe(true);
    expect(new Set(sms.map((p) => p.instance)).size).toBe(18);
    expect(groupParts(sms).instanced).toHaveLength(1);
  });

  it('keeps every part inside the plate and every SM on its TPC slab', () => {
    const ps = layoutGpc(findNode(root, GPC9));
    const plate = plateOf(ps);
    for (const p of ps.slice(1)) {
      for (const axis of [0, 2] as const) {
        expect(Math.abs(p.position[axis]) + p.size[axis] / 2).toBeLessThanOrEqual(plate.size[axis] / 2);
      }
    }
    for (const sm of ofKind(ps, 'sm')) {
      const slab = ofKind(ps, 'tpc').find((t) => Math.abs(t.position[0] - sm.position[0]) < t.size[0] / 2
        && Math.abs(t.position[2] - sm.position[2]) < t.size[2] / 2);
      expect(slab, sm.key).toBeDefined();
    }
  });
});

describe('layoutSm', () => {
  const ps = () => layoutSm(findNode(root, GPC8), findNode(root, SM(GPC8)));

  it('has the 4 sub-partitions of the tree, each enterable, plus L1 / shared memory and TMA', () => {
    expect(ofKind(ps(), 'subpartition').map((p) => p.enterId)).toEqual(Array<string>(4).fill(SUB(GPC8)));
    expect(ofKind(ps(), 'l1-shared')).toHaveLength(1);
    expect(ofKind(ps(), 'tma')).toHaveLength(1);
  });

  it('keeps the parts inside the plate and apart from each other', () => {
    const all = ps();
    const plate = plateOf(all);
    const parts = all.slice(1);
    for (const p of parts) {
      for (const axis of [0, 2] as const) {
        expect(Math.abs(p.position[axis]) + p.size[axis] / 2).toBeLessThanOrEqual(plate.size[axis] / 2);
      }
    }
    parts.forEach((a, i) => {
      for (const b of parts.slice(i + 1)) {
        const apartX = Math.abs(a.position[0] - b.position[0]) >= (a.size[0] + b.size[0]) / 2 - 1e-9;
        const apartZ = Math.abs(a.position[2] - b.position[2]) >= (a.size[2] + b.size[2]) / 2 - 1e-9;
        expect(apartX || apartZ, `${a.key} vs ${b.key}`).toBe(true);
      }
    });
  });
});

describe('layoutSubpartition', () => {
  const ps = () => layoutSubpartition(findNode(root, GPC9), findNode(root, SUB(GPC9)));

  it('draws the tree\'s count of every unit: 32 FP32, 16 INT32, 16 FP64, 8 load/store', () => {
    expect(ofKind(ps(), 'fp32-core')).toHaveLength(32);
    expect(ofKind(ps(), 'int32-core')).toHaveLength(16);
    expect(ofKind(ps(), 'fp64-core')).toHaveLength(16);
    expect(ofKind(ps(), 'ld-st')).toHaveLength(8);
    for (const kind of ['warp-scheduler', 'register-file', 'tensor-core', 'sfu'] as const) {
      expect(ofKind(ps(), kind), kind).toHaveLength(1);
    }
  });

  it('has no warp: it is a logical grouping, not a part (brief §4.1)', () => {
    expect(ps().some((p) => /warp(?!-scheduler)/i.test(`${p.kind} ${p.nodeId}`))).toBe(false);
  });

  it('keeps the parts inside the plate and apart from each other', () => {
    const all = ps();
    const plate = plateOf(all);
    const parts = all.slice(1);
    for (const p of parts) {
      for (const axis of [0, 2] as const) {
        expect(Math.abs(p.position[axis]) + p.size[axis] / 2).toBeLessThanOrEqual(plate.size[axis] / 2 + 1e-9);
      }
    }
    parts.forEach((a, i) => {
      for (const b of parts.slice(i + 1)) {
        const apartX = Math.abs(a.position[0] - b.position[0]) >= (a.size[0] + b.size[0]) / 2 - 1e-9;
        const apartZ = Math.abs(a.position[2] - b.position[2]) >= (a.size[2] + b.size[2]) / 2 - 1e-9;
        expect(apartX || apartZ, `${a.key} vs ${b.key}`).toBe(true);
      }
    });
  });

  it('is not clickable below here', () => {
    expect(ps().every((p) => p.enterId === null)).toBe(true);
  });
});

describe('level frames', () => {
  const path = ['die', GPC8, SM(GPC8), SUB(GPC8)];
  const picks = [0, 5, 3, 2];

  it('puts the die level where the package\'s die is, and the package at the identity', () => {
    expect(levelFrame(root, [], [])).toEqual({ scale: 1, position: [0, 0, 0] });
    expect(levelFrame(root, ['die'], [0])).toEqual(DIE_FRAME);
  });

  it('covers the tile it was entered from, at every level', () => {
    // The footprint of a level's plate, in the world, equals the tile's in its parent.
    for (let depth = 2; depth <= 4; depth++) {
      const parent = levelContent(root, path.slice(0, depth - 1), picks.slice(0, depth - 1));
      const child = levelContent(root, path.slice(0, depth), picks.slice(0, depth));
      const tile = parent.placements.find((p) => p.kind === child.own && p.nodeId === path[depth - 1] && p.instance === picks[depth - 1]);
      if (!tile) throw new Error(`no tile at depth ${String(depth)}`);
      const plate = plateOf(child.placements);
      const world = (frame: { scale: number }, v: number) => v * frame.scale;
      expect(world(child.frame, plate.size[0])).toBeCloseTo(world(parent.frame, tile.size[0]), 9);
      // Same shape, so landing swaps the tile for the plate without a jump.
      expect(plate.size[2] / plate.size[0]).toBeCloseTo(tile.size[2] / tile.size[0], 2);
      // Top surface on the tile's top surface.
      const tileTop = parent.frame.position[1] + parent.frame.scale * (tile.position[1] + tile.size[1] / 2);
      expect(child.frame.position[1]).toBeCloseTo(tileTop, 9);
    }
  });

  it('shrinks with depth and rejects a tile that is not there', () => {
    const scales = [1, 2, 3, 4].map((d) => levelFrame(root, path.slice(0, d), picks.slice(0, d)).scale);
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1] ?? 0);
    expect(() => levelContent(root, ['die', GPC9, SM(GPC9)], [0, 7, 0])).toThrow();
    // The GPC picked decides the position: two instances of one variant sit in different places.
    expect(levelFrame(root, ['die', GPC8], [0, 0]).position).not.toEqual(levelFrame(root, ['die', GPC8], [0, 1]).position);
  });

  it('finds the GPC tile in the die layout it is entered from', () => {
    const tiles = ofKind(layoutDie(die), 'gpc');
    expect(tiles.filter((t) => t.nodeId === GPC8)).toHaveLength(6);
    expect(tiles.filter((t) => t.nodeId === GPC9)).toHaveLength(2);
  });
});
