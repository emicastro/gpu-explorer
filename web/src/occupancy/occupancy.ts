// Which SMs hold a block in each wave of a kernel (design §6.6, R11; ADR
// 0020). Pure: from the plan's grid and the hardware tree to SM indices and
// the placements they light. How many SMs are busy is the core's number; where
// they sit on the die is ours, and `simplified`: the block scheduler's real
// placement is neither public nor deterministic (design §4.3).
import type { HwNode, KernelPlan } from '../core/index.ts';
import { enabledInstances, instances, placementKey } from '../scene/layout.ts';

/** One enabled SM, located the way the die and GPC layouts draw it. */
export interface SmSlot {
  /** The SM node of the GPC's variant (`gpc-8tpc/tpc/sm`). */
  smId: string;
  /** The GPC variant's node. */
  gpcId: string;
  /** The GPC among its variant's instances: the pick of the GPC level (ADR 0019). */
  gpc: number;
  /** The SM among its GPC's tiles, in layout order. */
  local: number;
  /** SM tiles per GPC of this variant, fused-off ones included. */
  perGpc: number;
}

interface GpcSms {
  smId: string;
  gpcId: string;
  gpc: number;
  perGpc: number;
  enabled: number;
}

/** The GPCs of the die in layout order, with their SM tiles. */
function gpcSms(die: HwNode): GpcSms[] {
  const out: GpcSms[] = [];
  for (const variant of die.children.filter((c) => c.level === 'gpc')) {
    const tpc = variant.children.find((c) => c.level === 'tpc');
    const sm = tpc?.children.find((c) => c.level === 'sm');
    if (!tpc || !sm) throw new Error(`${variant.id} has no TPC with SMs`);
    const perTpc = instances(sm);
    for (let gpc = 0; gpc < instances(variant); gpc++) {
      // The fused-off TPCs are the last ones of the GPC (layout.ts), so the enabled SMs come first.
      out.push({ smId: sm.id, gpcId: variant.id, gpc, perGpc: instances(tpc) * perTpc, enabled: enabledInstances(tpc) * perTpc });
    }
  }
  return out;
}

/**
 * The enabled SMs in logical order: round-robin over the GPCs, skipping the
 * full ones, and layout order within each GPC (ADR 0020). Index `i` of the
 * result is logical SM `i`.
 */
export function smSlots(die: HwNode): SmSlot[] {
  const gpcs = gpcSms(die);
  const rounds = Math.max(0, ...gpcs.map((g) => g.enabled));
  const out: SmSlot[] = [];
  for (let local = 0; local < rounds; local++) {
    for (const g of gpcs) {
      if (local < g.enabled) out.push({ smId: g.smId, gpcId: g.gpcId, gpc: g.gpc, local, perGpc: g.perGpc });
    }
  }
  return out;
}

/** The waves of a kernel: rounds of its resident CTAs. */
export const waveCount = (kernel: KernelPlan): number => Math.max(kernel.grid.perWave.length, 1);

/**
 * The logical SMs with a block in wave `wave` of the kernel. Blocks land in
 * SM order, one per SM before any SM takes a second, so `per_wave[wave]`
 * blocks occupy that many SMs, up to `sms` (design §4.3).
 */
export function smOccupancy(kernel: KernelPlan, wave: number, sms: number): Set<number> {
  const blocks = kernel.grid.perWave[wave] ?? 0;
  return new Set(Array.from({ length: Math.min(blocks, sms) }, (_, i) => i));
}

/** A GPC instance: its variant's node and its index among them. */
export interface GpcRef {
  gpcId: string;
  gpc: number;
}

/**
 * The placement keys of the busy SMs: of the die's layout, or, with `only`,
 * of that GPC's own layout, where an SM's instance is its local index.
 */
export function busySmKeys(slots: SmSlot[], busy: Set<number>, only?: GpcRef): Set<string> {
  const keys = new Set<string>();
  for (const i of busy) {
    const s = slots[i];
    if (!s) continue;
    if (!only) keys.add(placementKey('sm', s.smId, s.gpc * s.perGpc + s.local));
    else if (s.gpcId === only.gpcId && s.gpc === only.gpc) keys.add(placementKey('sm', s.smId, s.local));
  }
  return keys;
}

/** How FA3 cut a decode attention kernel: one block per request, KV head and split. */
export interface SplitKv {
  requests: number;
  kvHeads: number;
  splits: number;
  blocks: number;
}

/**
 * The split-KV lesson's numbers (brief §7.2), when the kernel's blocks are
 * exactly requests × KV heads × splits: decode, with every request split the
 * same. Null for other kernels, prefill (several Q tiles per request) and
 * uneven splits.
 */
export function splitKv(kernel: KernelPlan, requests: number, kvHeads: number): SplitKv | null {
  if (kernel.impl !== 'fa3') return null;
  const splits = Math.round(kernel.grid.splits.value);
  const blocks = Math.round(kernel.grid.blocks.value);
  if (requests * kvHeads * splits !== blocks) return null;
  return { requests, kvHeads, splits, blocks };
}
