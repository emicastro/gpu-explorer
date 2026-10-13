import { useMemo } from 'react';
import { useStore } from '../state/store.ts';
import { Q } from '../quantity/Q.tsx';
import { hbmSegments } from './roofline.ts';

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
          <span key={s.key} className={`hbm-seg hbm-${s.key}`} style={{ width: `${(100 * s.frac).toFixed(3)}%` }} title={s.label} />
        ))}
        {bar.overflow && (
          <span
            className="hbm-excess"
            data-testid="hbm-excess"
            style={{ left: `${(100 * bar.capacityFrac).toFixed(3)}%` }}
            title="Over capacity"
          />
        )}
      </div>
      <ul className="hbm-legend">
        {bar.segments.map((s) => (
          <li key={s.key}>
            <span className={`hbm-swatch hbm-${s.key}`} /> {s.label}{' '}
            {s.parts.map((q, i) => <span key={i}>{i > 0 && ' + '}<Q value={q} compact /></span>)}
          </li>
        ))}
        {bar.overflow && <li><span className="hbm-swatch hbm-excess-swatch" /> Over capacity</li>}
      </ul>
      <p data-testid="hbm-max-batch">
        {bar.overflow ? 'The KV cache does not fit. ' : ''}
        Max batch at this context: <Q value={memory.maxBatch} />
      </p>
    </section>
  );
}
