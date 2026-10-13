// Naming a kernel of the plan so the name survives a re-evaluation (ADR 0020):
// by its first op and which of the kernels running that op it is. Pure.
import type { KernelPlan } from '../generated/KernelPlan.ts';
import type { StepPlan } from '../generated/StepPlan.ts';
import type { OpId } from '../generated/OpId.ts';
import type { OpKind } from '../generated/OpKind.ts';

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
