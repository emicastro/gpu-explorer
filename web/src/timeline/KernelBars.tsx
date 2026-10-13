import { useMemo } from 'react';
import { seekToKernel, seekToLayer } from '../playback/driver.ts';
import { kernelIndex, timelineFor } from '../playback/playback.ts';
import { refOf } from '../plan/kernels.ts';
import { useStore } from '../state/store.ts';
import { barsFor } from './bars.ts';

/** One bar per kernel (a folded layer is one bar); a click puts the playhead and the 3D on it. */
export function KernelBars() {
  const plan = useStore((s) => s.plan);
  const mode = useStore((s) => s.timeMode);
  const focus = useStore((s) => s.focusLayer);
  const scene = useStore((s) => s.sceneKernel);
  const bars = useMemo(() => {
    if (!plan) return [];
    return barsFor(plan, timelineFor(plan, mode, focus), kernelIndex(plan, scene));
  }, [plan, mode, focus, scene]);
  if (!plan) return null;

  return (
    <div className="kernel-bars" role="group" aria-label="Kernels" data-testid="kernel-bars">
      {bars.map((bar) => {
        const { segment } = bar;
        const kernel = plan.kernels[segment.first];
        return (
          <button
            key={bar.key}
            type="button"
            className={`kernel-bar kernel-bar-${bar.tone}`}
            style={{ left: `${bar.left.toFixed(3)}%`, width: `${bar.width.toFixed(3)}%` }}
            aria-label={bar.label}
            aria-pressed={bar.active}
            title={bar.label}
            onClick={() => {
              if (segment.kind === 'layer' && segment.layer !== null) seekToLayer(segment.layer);
              else if (kernel) seekToKernel(refOf(plan, kernel));
            }}
          />
        );
      })}
    </div>
  );
}
