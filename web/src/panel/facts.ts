// What the component panel says (design §6.4, R9). Pure: from a hardware node
// and the plan's current kernel to display facts. The numbers are the plan's
// and the tree's; nothing here computes a new one.
import type { HwNode, KernelPlan, Quantity } from '../core/index.ts';
import { formatBytes, formatBytesShort } from '../flow/flow.ts';
import type { Impl } from '../generated/Impl.ts';

/** Kernels whose math runs on the tensor cores. */
const TENSOR_CORE_IMPLS: ReadonlySet<Impl> = new Set<Impl>([
  'cublas_bf16',
  'cutlass_fp8_tensor',
  'flashinfer_swapab',
  'deepgemm_sm90',
  'marlin_w8a16',
  'fa3',
]);

export const usesTensorCores = (kernel: KernelPlan): boolean => TENSOR_CORE_IMPLS.has(kernel.impl);

/** A line of the panel: a number with its confidence, or plain words. */
export type Fact = { label: string; value: Quantity } | { label: string; text: string };

/** `maxWarps` → `Max warps`. */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A quantity for reading: the exact bytes with the rounded ones, or the value with its unit. */
export function formatQuantity(q: Quantity): string {
  switch (q.unit) {
    case 'B':
      return `${formatBytes(q.value)} (${formatBytesShort(q.value)})`;
    case 'B/s':
      return `${formatBytesShort(q.value)}/s`;
    case 'Hz':
      return `${(q.value / 1e9).toFixed(2)} GHz`;
    case 'count':
      return Math.round(q.value).toLocaleString('en-US');
    case '1':
      return String(q.value);
    default:
      return `${q.value.toLocaleString('en-US')} ${q.unit}`;
  }
}

/** The tree's own numbers for one instance: its specs, as facts. */
export function specFacts(node: HwNode): Fact[] {
  return Object.entries(node.specs).map(([key, value]) => ({ label: humanize(key), value }));
}

/** How many there are in the parent, and how many are fused off: `×132 (+12 off)`. */
export function countText(node: HwNode): string | null {
  if (!node.count) return null;
  const total = Math.round(node.count.value);
  const on = Math.round(node.enabled?.value ?? total);
  return on < total ? `×${String(on)} (+${String(total - on)} off)` : `×${String(total)}`;
}

/** Prose for a component until the content pipeline (task 8.1) provides it. */
export function proseFor(node: HwNode): { text: string; stub: boolean } {
  return { text: `${node.name}: the description has not been written yet.`, stub: true };
}

const text = (label: string, t: string): Fact => ({ label, text: t });

/**
 * What the LLM does at this component, for the kernel the scene is on: the
 * bytes that pass, the blocks it holds, whether it runs the math. Components
 * the kernel doesn't single out say so.
 */
export function llmHere(node: HwNode, kernel: KernelPlan | null): Fact[] {
  if (!kernel) return [text('Kernel', 'No kernel to show: the plan is not available.')];
  const head = text('Kernel', `${kernel.name} · ${kernel.ops.map((o) => o.kind).join(', ')}`);
  const blocks: Fact[] = [
    { label: 'Blocks (CTAs)', value: kernel.grid.blocks },
    { label: 'SMs with work', value: kernel.grid.activeSms },
    { label: 'Waves', value: kernel.grid.waves },
  ];
  switch (node.level) {
    case 'board':
    case 'package':
      return [head, { label: 'Read from HBM', value: kernel.bytes.hbmRead }, { label: 'Written to HBM', value: kernel.bytes.hbmWrite }];
    case 'die':
      return [head, { label: 'Read from HBM, through the die', value: kernel.bytes.hbmRead }, ...blocks];
    case 'gpc':
    case 'tpc':
    case 'sm':
      return [head, ...blocks, text('Tile of one block', kernel.grid.tile.join(' × '))];
    case 'subpartition':
      return [head, text('Tensor cores', usesTensorCores(kernel) ? 'used: the kernel\'s math runs on them' : 'not used by this kernel')];
    case 'unit':
      return [head, ...unitFacts(node, kernel)];
    default:
      return [head];
  }
}

function unitFacts(node: HwNode, kernel: KernelPlan): Fact[] {
  switch (node.contentId) {
    case 'hbm-stack':
      return [{ label: 'Read from HBM (all sites)', value: kernel.bytes.hbmRead }, { label: 'Written to HBM', value: kernel.bytes.hbmWrite }];
    case 'l2':
    case 'memory-controller':
      return [{ label: 'Bytes crossing, from HBM', value: kernel.bytes.hbmRead }];
    case 'tensor-core':
      return usesTensorCores(kernel)
        ? [text('Used', `yes, ${kernel.precision.toUpperCase()}`), { label: 'FLOPs of the kernel', value: kernel.flops }]
        : [text('Used', 'no: this kernel does no tensor-core math')];
    case 'cuda-core':
      return [text('Used', usesTensorCores(kernel) ? 'mostly idle: the math is on the tensor cores' : 'yes: this kernel\'s math runs here')];
    default:
      return [text('Role in this kernel', 'not singled out by it')];
  }
}
