import { useMemo } from 'react';
import { kernelLabel, kernelPlace } from '../plan/kernels.ts';
import { useStore } from '../state/store.ts';
import { layerMarks, totalDuration } from '../timeline/timeline.ts';
import { KernelBars } from '../timeline/KernelBars.tsx';
import { seekToLayer } from './driver.ts';
import { kernelAt, SPEEDS, timelineFor } from './playback.ts';

/** Play, pause, scrub and speed (design §6.5, R10); the layer in detail. */
export function Transport() {
  const plan = useStore((s) => s.plan);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const mode = useStore((s) => s.timeMode);
  const focus = useStore((s) => s.focusLayer);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const segments = useMemo(() => (plan ? timelineFor(plan, mode, focus) : []), [plan, mode, focus]);
  const total = totalDuration(segments);
  const marks = useMemo(() => layerMarks(segments), [segments]);
  if (!plan || total <= 0) return null;

  const under = kernelAt(plan, segments, playhead);
  const kernel = under && plan.kernels[under.index];

  return (
    <section className="transport" aria-label="Playback" data-testid="transport">
      <div className="transport-row">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => { setPlaying(!playing); }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="transport-scrub">
          <input
            type="range"
            aria-label="Timeline"
            min={0}
            max={total}
            step="any"
            value={Math.min(playhead, total)}
            onChange={(e) => { setPlayhead(Number(e.target.value)); }}
          />
          <div className="transport-marks" aria-hidden="true">
            {marks.map((m) => (
              <span key={m.layer} style={{ left: `${(100 * m.at / total).toFixed(3)}%` }} />
            ))}
          </div>
        </div>
        <span className="transport-time">{playhead.toFixed(1)} / {total.toFixed(1)} s</span>
      </div>
      <KernelBars />
      <div className="transport-row">
        <label>
          Speed{' '}
          <select aria-label="Speed" value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); }}>
            {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </label>
        <label>
          Layer{' '}
          <select
            aria-label="Layer"
            value={focus ?? ''}
            onChange={(e) => { seekToLayer(Number(e.target.value)); }}
          >
            {plan.layers.map((l) => <option key={l.layer} value={l.layer}>{l.layer}</option>)}
          </select>
        </label>
      </div>
      {kernel && (
        <p className="transport-now" data-testid="transport-now">
          {kernelLabel(kernel)} · {kernelPlace(kernel)}
        </p>
      )}
    </section>
  );
}
