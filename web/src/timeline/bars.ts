// The kernel bars under the scrub bar (design §6.8): one bar per timeline
// segment, placed by its share of the axis. Pure.
import type { StepPlan } from '../generated/StepPlan.ts';
import { kernelLabel } from '../plan/kernels.ts';
import { totalDuration, type Segment } from './timeline.ts';

export interface Bar {
  /** Unique among the bars. */
  key: string;
  /** Where it starts and how wide it is, as a percentage of the axis. */
  left: number;
  width: number;
  /** A folded layer is `layer`; a kernel says which roof limits it. */
  tone: 'memory' | 'compute' | 'layer';
  label: string;
  /** The bar holds the kernel the scene shows. */
  active: boolean;
  segment: Segment;
}

/** One bar per segment; `sceneIndex` is the plan index of the kernel the scene shows. */
export function barsFor(plan: StepPlan, segments: Segment[], sceneIndex: number): Bar[] {
  const total = totalDuration(segments);
  if (total <= 0) return [];
  return segments.map((segment) => {
    const kernel = plan.kernels[segment.first];
    const folded = segment.kind === 'layer';
    return {
      key: `${String(segment.first)}-${String(segment.end)}`,
      left: (100 * segment.start) / total,
      width: (100 * segment.duration) / total,
      tone: folded || !kernel ? 'layer' : kernel.bound,
      label: folded ? `layer ${String(segment.layer)}` : kernel ? kernelLabel(kernel) : '',
      active: sceneIndex >= segment.first && sceneIndex < segment.end,
      segment,
    };
  });
}
