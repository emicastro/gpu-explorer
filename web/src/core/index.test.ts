import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Quantity } from '../generated/Quantity.ts';
import { evaluate, hardware, initCoreSync, models, version, type Scenario } from './index.ts';

beforeAll(() => {
  // Built by scripts/build-wasm.sh.
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
});

const decode = (batch: number, context: number): Scenario => ({
  phase: 'decode',
  contexts: Array<number>(batch).fill(context),
  newTokens: 1,
  weights: 'bf16',
  kv: 'bf16',
});

function isQuantity(q: Quantity): void {
  expect(typeof q.value).toBe('number');
  expect(typeof q.unit).toBe('string');
  expect(['documented', 'simplified', 'estimated']).toContain(q.confidence);
  expect(Array.isArray(q.sources)).toBe(true);
}

describe('core', () => {
  it('reports the crate version across the WASM boundary', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('returns the hardware tree with specs as plain objects', () => {
    const root = hardware('h100-sxm');
    expect(root.level).toBe('board');
    const pkg = root.children.find((c) => c.id === 'package');
    expect(pkg).toBeDefined();
    const bandwidth = pkg?.specs.hbmBandwidth;
    expect(bandwidth).toBeDefined();
    if (bandwidth) isQuantity(bandwidth);
  });

  it('lists the model presets', () => {
    const [qwen] = models();
    expect(qwen?.id).toBe('qwen3-8b');
    expect(qwen?.config.num_hidden_layers).toBe(36);
  });

  it('round-trips a scenario built in TS into a step plan of the generated shape', () => {
    const plan = evaluate('h100-sxm', 'qwen3-8b', decode(1, 8192));
    expect(plan.layers).toHaveLength(36);
    expect(plan.kernels.length).toBeGreaterThan(36 * 11);

    const qkv = plan.kernels.find((k) => k.ops.some((o) => o.kind === 'qkv_proj'));
    expect(qkv).toBeDefined();
    if (!qkv) return;
    expect(qkv.id).toMatch(/^k\d+$/);
    expect(qkv.layer).toBe(0);
    expect(qkv.bound).toBe('memory');
    expect(qkv.grid.tile).toHaveLength(3);
    expect(qkv.grid.perWave.length).toBeGreaterThan(0);
    for (const q of [qkv.flops, qkv.bytes.hbmRead, qkv.intensity, qkv.time.realistic, qkv.grid.blocks]) {
      isQuantity(q);
    }
    expect(qkv.bytes.hbmRead.unit).toBe('B');

    expect(plan.kernels[0]?.layer).toBeNull();
    isQuantity(plan.totals.time.realistic);
    expect(plan.totals.tokensPerSecond.realistic.unit).toBe('tok/s');
    expect(plan.memory.overflow).toBe(false);
  });

  it('flags a batch that does not fit instead of throwing', () => {
    expect(evaluate('h100-sxm', 'qwen3-8b', decode(1, 131072)).memory.overflow).toBe(false);
    expect(evaluate('h100-sxm', 'qwen3-8b', decode(64, 131072)).memory.overflow).toBe(true);
  });

  it('throws the core error for an invalid scenario or id', () => {
    expect(() => evaluate('h100-sxm', 'qwen3-8b', decode(0, 1))).toThrow(/invalid scenario/);
    expect(() => evaluate('a100', 'qwen3-8b', decode(1, 1))).toThrow(/unknown hardware id/);
    expect(() => hardware('a100')).toThrow(/unknown hardware id/);
  });
});
