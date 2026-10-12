import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { hardware, initCoreSync, type HwNode } from '../core/index.ts';
import { FLOW_STAGES } from '../flow/flow.ts';
import { levelLabels, type SceneLabel } from './labels.ts';
import { layoutDie, layoutPackage, nodeAtLevel } from './layout.ts';

let root: HwNode;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  root = hardware('h100-sxm');
});

const byKind = (labels: SceneLabel[], kind: SceneLabel['kind']) => labels.find((l) => l.kind === kind);

describe('package labels', () => {
  it('name the die, the HBM with its count, the interposer and the substrate', () => {
    const labels = levelLabels(layoutPackage(nodeAtLevel(root, 'package')));
    expect(byKind(labels, 'hbm')?.text).toBe('HBM3 ×5 (+1 off)');
    expect(byKind(labels, 'die')?.text).toBe('GH100 die · click to enter');
    expect(byKind(labels, 'interposer')?.text).toBe('Interposer');
    expect(byKind(labels, 'substrate')?.text).toBe('Substrate');
    // Detail that doesn't help reading has no label.
    expect(byKind(labels, 'bumps')).toBeUndefined();
    expect(byKind(labels, 'stiffener')).toBeUndefined();
  });
});

describe('die labels', () => {
  const labels = () => levelLabels(layoutDie(nodeAtLevel(root, 'die')), 'die');

  it('carry the tree\'s counts', () => {
    expect(byKind(labels(), 'sm')?.text).toBe('SM ×132 (+12 off)');
    expect(byKind(labels(), 'gpc')?.text).toBe('GPC ×8');
    expect(byKind(labels(), 'memory-controller')?.text).toBe('Memory controllers ×10 (+2 off) · to HBM');
    expect(byKind(labels(), 'l2')?.text).toBe('L2 cache');
    expect(byKind(labels(), 'gigathread')?.text).toBe('GigaThread engine');
    // Inside the die, the die itself has no label (and no "click to enter").
    expect(byKind(labels(), 'die')).toBeUndefined();
  });

  it('tie the controllers, the L2 and the SMs to their flow stops', () => {
    const stop = (kind: SceneLabel['kind']) => {
      const s = byKind(labels(), kind)?.stop;
      return s === null || s === undefined ? null : FLOW_STAGES[s];
    };
    expect(stop('memory-controller')).toBe('HBM');
    expect(stop('l2')).toBe('L2');
    expect(stop('sm')).toBe('SM');
    expect(stop('gpc')).toBeNull();
  });

  it('put the SM label on the front row, away from the controllers\' label', () => {
    const sm = byKind(labels(), 'sm');
    const mc = byKind(labels(), 'memory-controller');
    expect(sm?.anchor[2]).toBeGreaterThan(0);
    expect(mc?.anchor[2]).toBeGreaterThan(0);
  });

  it('do not stack two labels on one spot', () => {
    const spots = labels().map((l) => l.anchor.map((c) => c.toFixed(2)).join(','));
    expect(new Set(spots).size).toBe(spots.length);
  });
});
