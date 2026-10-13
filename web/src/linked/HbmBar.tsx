import { useMemo } from 'react';
import { useStore } from '../state/store.ts';
import { hbmSegments } from './roofline.ts';

const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

/** Weights + KV + the rest over HBM capacity, with the batch that fits (design §6.8). */
export function HbmBar() {
  const plan = useStore((s) => s.plan);
  const bar = useMemo(() => (plan ? hbmSegments(plan) : null), [plan]);
  if (!plan || !bar) return null;
  const { memory } = plan;
  return (
    <section className={`hbm${bar.overflow ? ' hbm-overflow' : ''}`} aria-label="HBM" data-testid="hbm">
      <h3>HBM</h3>
      <div className="hbm-bar" data-testid="hbm-bar" data-overflow={bar.overflow} data-kv-bytes={memory.kv.value}>
        {bar.segments.filter((s) => s.bytes > 0).map((s) => (
          <span key={s.key} className={`hbm-seg hbm-${s.key}`} style={{ width: `${(100 * s.frac).toFixed(3)}%` }} title={`${s.label}: ${gb(s.bytes)}`} />
        ))}
        {bar.overflow && (
          <span
            className="hbm-excess"
            data-testid="hbm-excess"
            style={{ left: `${(100 * bar.capacityFrac).toFixed(3)}%` }}
            title={`Over capacity: ${gb(bar.excess)}`}
          />
        )}
      </div>
      <ul className="hbm-legend">
        {bar.segments.map((s) => (
          <li key={s.key}><span className={`hbm-swatch hbm-${s.key}`} /> {s.label} {gb(s.bytes)}</li>
        ))}
        {bar.overflow && <li><span className="hbm-swatch hbm-excess-swatch" /> Over capacity {gb(bar.excess)}</li>}
      </ul>
      <p data-testid="hbm-max-batch">
        {bar.overflow ? 'The KV cache does not fit. ' : ''}
        Max batch at this context: {memory.maxBatch.value}
      </p>
    </section>
  );
}
