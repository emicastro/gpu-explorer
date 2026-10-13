import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, hardware, initCoreSync, models, type HwNode, type StepPlan } from '../core/index.ts';
import { flowRoutes } from '../flow/flow.ts';
import { DEFAULT_KERNEL, findKernel, refOf, resolveKernel, sceneKernel } from '../plan/kernels.ts';
import { layoutDie, layoutGpc, nodeAtLevel, type Placement } from '../scene/layout.ts';
import { DEFAULT_SCENARIO, toScenario } from '../state/store.ts';
import type { Knobs } from '../state/types.ts';
import { busySmKeys, smOccupancy, smSlots, splitKv, waveCount, type SmSlot } from './occupancy.ts';
import { clampWave } from './wave.ts';

let root: HwNode;
let die: HwNode;
let slots: SmSlot[];
let dieParts: Placement[];
let kvHeads: number;

const plan = (patch: Partial<Knobs>): StepPlan =>
  evaluate('h100-sxm', 'qwen3-8b', toScenario({ ...DEFAULT_SCENARIO, ...patch }));

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  root = hardware('h100-sxm');
  die = nodeAtLevel(root, 'die');
  slots = smSlots(die);
  dieParts = layoutDie(die);
  const qwen = models().find((m) => m.id === 'qwen3-8b');
  if (!qwen) throw new Error('no Qwen3-8B preset');
  kvHeads = qwen.config.num_key_value_heads;
});

describe('logical SM order (ADR 0020)', () => {
  it('has one slot per enabled SM, each drawn once on the die', () => {
    expect(slots).toHaveLength(132);
    const keys = busySmKeys(slots, new Set(slots.map((_, i) => i)));
    expect(keys.size).toBe(132);
    const enabled = new Set(dieParts.filter((p) => p.kind === 'sm' && p.enabled).map((p) => p.key));
    expect([...keys].every((k) => enabled.has(k))).toBe(true);
  });

  it('goes round-robin over the 8 GPCs before any GPC takes a second block', () => {
    const gpcOf = (s: SmSlot) => `${s.gpcId}#${String(s.gpc)}`;
    expect(new Set(slots.slice(0, 8).map(gpcOf)).size).toBe(8);
    // The two 9-TPC GPCs take the last four slots alone, once the others are full.
    expect(new Set(slots.slice(128).map((s) => s.gpcId))).toEqual(new Set(['gpc-9tpc']));
  });
});

describe('smOccupancy', () => {
  it('lights per_wave[i] SMs, up to 132, for every kernel and wave of several plans', () => {
    const plans = [plan({}), plan({ batch: 32 }), plan({ weights: 'fp8_block' }), plan({ phase: 'prefill', context: 2048 })];
    for (const p of plans) {
      for (const k of p.kernels) {
        k.grid.perWave.forEach((blocks, wave) => {
          expect(smOccupancy(k, wave, slots.length).size).toBe(Math.min(blocks, 132));
        });
      }
    }
  });

  it('is empty past the last wave', () => {
    const qkv = findKernel(plan({}), 'qkv_proj');
    if (!qkv) throw new Error('no QKV GEMM');
    expect(smOccupancy(qkv, waveCount(qkv), 132).size).toBe(0);
  });
});

describe('the split-KV lesson: decode attention, batch 1, 8k (brief §7.2)', () => {
  it('cuts 1 request × 8 KV heads × 13 splits = 104 blocks onto 104 SMs, in one wave', () => {
    const attention = findKernel(plan({}), 'attention');
    if (!attention) throw new Error('no attention kernel');
    expect(attention.impl).toBe('fa3');
    expect(waveCount(attention)).toBe(1);
    expect(smOccupancy(attention, 0, 132).size).toBe(104);
    expect(attention.grid.activeSms.value).toBe(104);
    expect(splitKv(attention, 1, kvHeads)).toEqual({ requests: 1, kvHeads: 8, splits: 13, blocks: 104 });
  });

  it('puts 13 of the 104 blocks in every GPC', () => {
    const busy = smOccupancy(findKernel(plan({}), 'attention') ?? (() => { throw new Error('no attention'); })(), 0, 132);
    for (const [gpcId, count] of [['gpc-8tpc', 6], ['gpc-9tpc', 2]] as const) {
      for (let gpc = 0; gpc < count; gpc++) {
        expect(busySmKeys(slots, busy, { gpcId, gpc }).size).toBe(13);
      }
    }
  });

  it('lights SMs of the GPC level that its own layout draws, all enabled', () => {
    const variant = die.children.find((c) => c.id === 'gpc-8tpc');
    if (!variant) throw new Error('no gpc-8tpc');
    const gpcParts = layoutGpc(variant);
    const keys = busySmKeys(slots, new Set(slots.map((_, i) => i)), { gpcId: 'gpc-8tpc', gpc: 3 });
    const drawn = gpcParts.filter((p) => keys.has(p.key));
    expect(drawn).toHaveLength(16);
    expect(drawn.every((p) => p.kind === 'sm' && p.enabled)).toBe(true);
  });

  it('follows the brief\'s table at batch 8 (2 splits, 128 blocks) and batch 32 (1 split, 2 waves)', () => {
    const b8 = findKernel(plan({ batch: 8 }), 'attention');
    expect(b8 && splitKv(b8, 8, kvHeads)).toEqual({ requests: 8, kvHeads: 8, splits: 2, blocks: 128 });
    const b32 = findKernel(plan({ batch: 32 }), 'attention');
    if (!b32) throw new Error('no attention kernel');
    expect(splitKv(b32, 32, kvHeads)?.splits).toBe(1);
    expect(waveCount(b32)).toBe(2);
    expect(smOccupancy(b32, 0, 132).size).toBe(132);
    expect(smOccupancy(b32, 1, 132).size).toBe(256 - 132);
  });

  it('has no split-KV numbers for a GEMM or the combine', () => {
    const p = plan({});
    const qkv = findKernel(p, 'qkv_proj');
    const combine = resolveKernel(p, { op: { kind: 'attention', layer: 0 }, nth: 1 });
    expect(combine?.impl).toBe('fa3_combine');
    expect(qkv && splitKv(qkv, 1, kvHeads)).toBeNull();
    expect(combine && splitKv(combine, 1, kvHeads)).toBeNull();
  });
});

describe('the flow lands on the busy SMs only', () => {
  it('routes the attention\'s bytes to its 104 SMs, and none to idle ones', () => {
    const attention = findKernel(plan({}), 'attention');
    if (!attention) throw new Error('no attention kernel');
    const busy = busySmKeys(slots, smOccupancy(attention, 0, 132));
    const sms = dieParts.filter((p) => p.kind === 'sm');
    for (const [, , , end] of flowRoutes(dieParts, busy)) {
      const sm = sms.find((p) => p.position[0] === end[0] && p.position[2] === end[2]);
      expect(sm && busy.has(sm.key)).toBe(true);
    }
  });

  it('skips the GPCs a small kernel leaves idle', () => {
    // 4 blocks: the first four GPCs in the round-robin.
    const busy = busySmKeys(slots, new Set([0, 1, 2, 3]));
    expect(flowRoutes(dieParts, busy)).toHaveLength(10 * 4);
  });
});

describe('kernel refs (ADR 0020)', () => {
  it('name every kernel of a plan uniquely and resolve back to it', () => {
    const p = plan({ weights: 'fp8_block' });
    for (const k of p.kernels) expect(resolveKernel(p, refOf(p, k))).toBe(k);
  });

  it('survive a re-evaluation that adds kernels', () => {
    const bf16 = plan({});
    const down = findKernel(bf16, 'down_proj');
    if (!down) throw new Error('no down projection');
    const ref = refOf(bf16, down);
    expect(resolveKernel(plan({ weights: 'fp8_block' }), ref)?.ops[0]?.kind).toBe('down_proj');
  });

  it('fall back to the QKV GEMM when the kernel is gone (no combine in a long prefill)', () => {
    const combine = { op: { kind: 'attention' as const, layer: 0 }, nth: 1 };
    // Over 512 tokens FA3 picks its own splits, and 1024 tiles fill the SMs: no split, no combine.
    const p = plan({ phase: 'prefill', context: 8192 });
    expect(resolveKernel(p, combine)).toBeNull();
    expect(sceneKernel(p, combine)).toBe(resolveKernel(p, DEFAULT_KERNEL));
  });
});

describe('the wave shown', () => {
  it('clamps a wave left over from a longer kernel', () => {
    expect(clampWave(2, 1)).toBe(0);
    expect(clampWave(1, 3)).toBe(1);
  });
});
