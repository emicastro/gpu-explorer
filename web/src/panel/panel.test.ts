import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, hardware, initCoreSync, type HwNode, type KernelPlan, type StepPlan } from '../core/index.ts';
import { findNode, nodeAtLevel } from '../scene/layout.ts';
import { DEFAULT_SCENARIO, toScenario } from '../state/store.ts';
import { countText, formatQuantity, humanize, llmHere, proseFor, specFacts, usesTensorCores } from './facts.ts';

let root: HwNode;
let plan: StepPlan;
let qkv: KernelPlan;
let norm: KernelPlan;

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  root = hardware('h100-sxm');
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario(DEFAULT_SCENARIO));
  const find = (kind: string) => plan.kernels.find((k) => k.layer === 0 && k.ops.some((o) => o.kind === kind));
  const a = find('qkv_proj');
  const b = find('input_norm');
  if (!a || !b) throw new Error('the plan lacks the kernels the tests use');
  qkv = a;
  norm = b;
});

const SM = 'gpc-8tpc/tpc/sm';
const fact = (node: HwNode, kernel: KernelPlan | null, label: string) => llmHere(node, kernel).find((f) => f.label === label);

describe('component panel facts', () => {
  it('gives the SM the kernel\'s blocks and active SMs, exactly the plan\'s', () => {
    const sm = findNode(root, SM);
    expect(fact(sm, qkv, 'Blocks (CTAs)')).toEqual({ label: 'Blocks (CTAs)', value: qkv.grid.blocks });
    expect(fact(sm, qkv, 'SMs with work')).toEqual({ label: 'SMs with work', value: qkv.grid.activeSms });
  });

  it('gives the HBM and the L2 the bytes the plan says pass', () => {
    const hbm = findNode(root, 'hbm-site');
    expect(fact(hbm, qkv, 'Read from HBM (all sites)')).toMatchObject({ value: qkv.bytes.hbmRead });
    expect(fact(findNode(root, 'l2'), qkv, 'Bytes crossing, from HBM')).toMatchObject({ value: qkv.bytes.hbmRead });
    expect(fact(nodeAtLevel(root, 'package'), qkv, 'Read from HBM')).toMatchObject({ value: qkv.bytes.hbmRead });
  });

  it('says whether the tensor cores run the math: yes for the QKV GEMM, no for a norm', () => {
    const tc = findNode(root, `${SM}/subpartition/tensor-core`);
    expect(usesTensorCores(qkv)).toBe(true);
    expect(usesTensorCores(norm)).toBe(false);
    expect(fact(tc, qkv, 'Used')).toMatchObject({ text: 'yes, BF16' });
    expect(fact(tc, norm, 'Used')).toMatchObject({ text: expect.stringContaining('no') as string });
  });

  it('follows the kernel: another kernel, other blocks', () => {
    const sm = findNode(root, SM);
    expect(fact(sm, norm, 'Blocks (CTAs)')).toMatchObject({ value: norm.grid.blocks });
  });

  it('says so, instead of failing, with no plan', () => {
    const [only] = llmHere(findNode(root, SM), null);
    expect(only).toMatchObject({ label: 'Kernel' });
  });

  it('answers for every node of the tree', () => {
    const walk = (n: HwNode) => {
      expect(llmHere(n, qkv).length, n.id).toBeGreaterThan(0);
      n.children.forEach(walk);
    };
    walk(root);
  });

  it('shows the node\'s specs with their confidence, and counts with the fused-off ones', () => {
    const specs = specFacts(findNode(root, SM));
    expect(specs.map((s) => s.label)).toContain('Max warps');
    expect(specs.every((s) => 'value' in s && s.value.sources.length >= 0)).toBe(true);
    expect(countText(findNode(root, 'memory-controller'))).toBe('×10 (+2 off)');
    expect(countText(findNode(root, 'l2'))).toBe('×2');
    expect(countText(nodeAtLevel(root, 'package'))).toBeNull();
  });

  it('formats quantities for reading and humanizes spec names', () => {
    const q = { confidence: 'documented' as const, sources: [] };
    expect(formatQuantity({ ...q, value: 50339840, unit: 'B' })).toBe('50,339,840 B (50.3 MB)');
    expect(formatQuantity({ ...q, value: 1.83e9, unit: 'Hz' })).toBe('1.83 GHz');
    expect(formatQuantity({ ...q, value: 65536, unit: 'count' })).toBe('65,536');
    expect(humanize('maxRegistersPerThread')).toBe('Max registers per thread');
  });

  it('marks prose as a stub until the content pipeline exists', () => {
    expect(proseFor(findNode(root, SM)).stub).toBe(true);
  });
});
