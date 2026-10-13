// Pure helpers for the knob panel (design §6.8, R13).
import type { KvDtype } from '../generated/KvDtype.ts';
import type { Phase } from '../generated/Phase.ts';
import type { Weights } from '../generated/Weights.ts';

export const BATCH_MAX = 512;
export const CONTEXT_MAX = 131072;
/** The model's native context; beyond it Qwen3 needs YaRN (brief D11). */
export const YARN_FROM = 32768;
/** Resolution of the log sliders. */
export const STEPS = 1000;

/** Slider position (0..STEPS) of a value on a log scale from 1 to `max`. */
export function toSlider(value: number, max: number): number {
  const v = Math.min(Math.max(value, 1), max);
  return Math.round((STEPS * Math.log(v)) / Math.log(max));
}

/** The integer value (1..`max`) at a slider position on a log scale. */
export function fromSlider(position: number, max: number): number {
  const t = Math.min(Math.max(position, 0), STEPS) / STEPS;
  return Math.min(max, Math.max(1, Math.round(Math.exp(t * Math.log(max)))));
}

export const WEIGHT_OPTIONS: readonly { value: Weights; label: string }[] = [
  { value: 'bf16', label: 'BF16' },
  { value: 'fp8_block', label: 'FP8 (block-wise)' },
  { value: 'fp8_tensor', label: 'FP8 (per-tensor)' },
  { value: 'fp8_w8a16', label: 'W8A16 (FP8 weights, BF16 activations)' },
];

export const KV_OPTIONS: readonly { value: KvDtype; label: string }[] = [
  { value: 'bf16', label: 'BF16' },
  { value: 'fp8', label: 'FP8' },
];

export const PHASE_OPTIONS: readonly { value: Phase; label: string }[] = [
  { value: 'decode', label: 'Decode' },
  { value: 'prefill', label: 'Prefill' },
];

/** The option whose value is `raw`, or null: a `<select>` hands back a plain string. */
export function pick<T extends string>(options: readonly { value: T }[], raw: string): T | null {
  return options.find((o) => o.value === raw)?.value ?? null;
}
