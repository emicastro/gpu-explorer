// Naming a kernel of the plan so the name survives a re-evaluation (ADR 0020):
// by its first op and which of the kernels running that op it is. Pure.
import type { KernelPlan } from '../generated/KernelPlan.ts';
import type { StepPlan } from '../generated/StepPlan.ts';
import type { OpId } from '../generated/OpId.ts';
import type { OpKind } from '../generated/OpKind.ts';
import type { Quantity } from '../generated/Quantity.ts';
import type { TrafficPlan } from '../generated/TrafficPlan.ts';

/** A kernel by what it does: its first op, and `nth` among the kernels that run that op. */
export interface KernelRef {
  op: OpId;
  nth: number;
}

/** The milestone's kernel (task 4.4), the scene's until something else is picked: layer 0's QKV GEMM. */
export const DEFAULT_KERNEL: KernelRef = { op: { kind: 'qkv_proj', layer: 0 }, nth: 0 };

const runs = (k: KernelPlan, op: OpId): boolean => k.ops.some((o) => o.kind === op.kind && o.layer === op.layer);

/** The first kernel that runs `op` in `layer` (null: before and after the layers). */
export function findKernel(plan: StepPlan, op: OpKind, layer: number | null = 0): KernelPlan | null {
  return plan.kernels.find((k) => runs(k, { kind: op, layer })) ?? null;
}

/** The kernel `ref` names, or null if this plan has none (a `combine` with one split). */
export function resolveKernel(plan: StepPlan, ref: KernelRef): KernelPlan | null {
  return plan.kernels.filter((k) => runs(k, ref.op))[ref.nth] ?? null;
}

/** The kernel `ref` names, or the default one if the plan has no such kernel. */
export function sceneKernel(plan: StepPlan, ref: KernelRef): KernelPlan | null {
  return resolveKernel(plan, ref) ?? resolveKernel(plan, DEFAULT_KERNEL);
}

/** Why the scene shows a layer's summary and not a kernel (ADR 0024). */
export interface SceneSummary {
  layer: number;
  /** `folded`: the layer is one segment of the timeline. `brief`: the kernel is too short to be seen (Real mode). */
  why: 'folded' | 'brief';
}

const sum = (kernels: KernelPlan[], pick: (k: KernelPlan) => Quantity): Quantity => {
  const first = pick(kernels[0] as KernelPlan);
  const confidences = ['documented', 'simplified', 'estimated'] as const;
  const worst = Math.max(...kernels.map((k) => confidences.indexOf(pick(k).confidence)));
  return {
    value: kernels.reduce((total, k) => total + pick(k).value, 0),
    unit: first.unit,
    confidence: confidences[worst] ?? 'estimated',
    sources: [...new Set(kernels.flatMap((k) => pick(k).sources))],
  };
};

const summaries = new WeakMap<StepPlan, Map<number, KernelPlan>>();

/**
 * One layer as a single `KernelPlan` (ADR 0024): the bytes, FLOPs and times
 * summed, one wave of the mean SM occupancy weighted by GPU time (`simplified`).
 * Null if the plan has no such layer.
 */
export function layerSummary(plan: StepPlan, layer: number): KernelPlan | null {
  const cached = summaries.get(plan)?.get(layer);
  if (cached) return cached;
  const span = plan.layers.find((l) => l.layer === layer);
  const kernels = span ? plan.kernels.slice(span.start, span.end) : [];
  const first = kernels[0];
  if (!first) return null;
  const total = kernels.reduce((t, k) => t + k.time.realistic.value, 0);
  const weight = (k: KernelPlan): number => (total > 0 ? k.time.realistic.value / total : 1 / kernels.length);
  // Per kernel, the SMs busy on average over its waves.
  const busy = (k: KernelPlan): number => {
    const waves = k.grid.perWave;
    return waves.length ? waves.reduce((t, n) => t + n, 0) / waves.length : 0;
  };
  const meanSms = Math.round(kernels.reduce((t, k) => t + weight(k) * busy(k), 0));
  const traffic = (pick: (k: KernelPlan) => TrafficPlan): TrafficPlan => ({
    weights: sum(kernels, (k) => pick(k).weights),
    kv: sum(kernels, (k) => pick(k).kv),
    activations: sum(kernels, (k) => pick(k).activations),
  });
  const summary: KernelPlan = {
    ...first,
    id: `layer-${String(layer)}`,
    name: `layer ${String(layer)}, ${String(kernels.length)} kernels`,
    ops: kernels.flatMap((k) => k.ops),
    flops: sum(kernels, (k) => k.flops),
    bytes: {
      hbmRead: sum(kernels, (k) => k.bytes.hbmRead),
      hbmWrite: sum(kernels, (k) => k.bytes.hbmWrite),
      unfused: sum(kernels, (k) => k.bytes.unfused),
    },
    phaseBreakdown: { read: traffic((k) => k.phaseBreakdown.read), write: traffic((k) => k.phaseBreakdown.write) },
    time: {
      ...first.time,
      lowerBound: sum(kernels, (k) => k.time.lowerBound),
      realistic: sum(kernels, (k) => k.time.realistic),
    },
    grid: {
      ...first.grid,
      perWave: [meanSms],
      waves: { ...first.grid.waves, value: 1, confidence: 'simplified' },
      activeSms: { ...first.grid.activeSms, value: meanSms, confidence: 'simplified' },
    },
  };
  const perPlan = summaries.get(plan) ?? new Map<number, KernelPlan>();
  perPlan.set(layer, summary);
  summaries.set(plan, perPlan);
  return summary;
}

/** What the scene shows: the layer's summary if there is one, else the kernel `ref` names. */
export function sceneSubject(plan: StepPlan, ref: KernelRef, summary: SceneSummary | null): KernelPlan | null {
  return (summary && layerSummary(plan, summary.layer)) ?? sceneKernel(plan, ref);
}

/** The ref that names `kernel` in `plan`. */
export function refOf(plan: StepPlan, kernel: KernelPlan): KernelRef {
  const op = kernel.ops[0];
  if (!op) throw new Error(`kernel ${kernel.id} runs no op`);
  const nth = plan.kernels.filter((k) => runs(k, op)).indexOf(kernel);
  if (nth < 0) throw new Error(`kernel ${kernel.id} is not in the plan`);
  return { op, nth };
}

export const sameRef = (a: KernelRef, b: KernelRef): boolean =>
  a.op.kind === b.op.kind && a.op.layer === b.op.layer && a.nth === b.nth;

/** What each op does, in a few words of the UI's language. */
export const OP_LABELS: Record<OpKind, string> = {
  prepare_inputs: 'prepare inputs',
  attention_schedule: 'attention schedule',
  embedding: 'embedding',
  input_norm: 'input RMSNorm',
  qkv_quant: 'QKV input quantization',
  qkv_proj: 'QKV projection',
  qk_norm: 'QK norm',
  rope: 'RoPE',
  kv_write: 'KV cache write',
  attention: 'attention',
  o_quant: 'O input quantization',
  o_proj: 'O projection',
  attn_residual: 'residual add',
  post_attn_norm: 'post-attention RMSNorm',
  gate_up_quant: 'gate/up input quantization',
  gate_up_proj: 'gate/up projection',
  silu_mul: 'SiLU × up',
  down_quant: 'down input quantization',
  down_proj: 'down projection',
  mlp_residual: 'residual add',
  final_norm: 'final RMSNorm',
  gather_last: 'gather last tokens',
  lm_head: 'LM head',
  sampling: 'sampling',
};

/** The ops a kernel fuses, in words: `QK norm + RoPE`. A `combine` says so. */
export function kernelLabel(kernel: KernelPlan): string {
  const ops = kernel.ops.map((o) => OP_LABELS[o.kind]).join(' + ');
  return kernel.impl === 'fa3_combine' ? `${ops} (combine splits)` : ops;
}

/** Where the kernel runs in the step: `layer 0`, or outside the layer loop. */
export const kernelPlace = (kernel: KernelPlan): string =>
  kernel.layer === null ? 'outside the layers' : `layer ${String(kernel.layer)}`;
