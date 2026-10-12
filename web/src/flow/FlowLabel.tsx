import type { Quantity } from '../core/index.ts';
import { FLOW_COLORS, type TrafficClass } from '../scene/palette.ts';
import { useStore } from '../state/store.ts';
import { FLOW_OP, FLOW_STAGES, findKernel, flowStreams, formatBytes, formatBytesShort } from './flow.ts';
import { stopIsActive, useFlowStage } from './stage.ts';

const CLASS_LABELS: Record<TrafficClass, string> = {
  weights: 'Weights',
  kv: 'KV cache',
  activations: 'Activations',
};

/** The exact count, a rounded one and its confidence. Task 7.4 replaces this with `<Q>`. */
function Bytes({ q, testId }: { q: Quantity; testId?: string }) {
  return (
    <>
      <span className="flow-exact" data-testid={testId}>{formatBytes(q.value)}</span>{' '}
      <span className="flow-short">({formatBytesShort(q.value)})</span>{' '}
      <span className={`confidence confidence-${q.confidence}`} title={q.confidence} aria-label={q.confidence} />
    </>
  );
}

/** What the particles on the die stand for, with the exact bytes of the plan (R11). */
export function FlowLabel() {
  const plan = useStore((s) => s.plan);
  const atDie = useStore((s) => s.path.length === 1 && s.from === null);
  const leg = useFlowStage((s) => s.leg);
  const kernel = plan && atDie ? findKernel(plan, FLOW_OP) : null;
  if (!kernel) return null;
  return (
    <aside className="flow-label" aria-label="Data flow">
      <p className="flow-kernel">
        <code>{kernel.name}</code> · QKV projection · layer {String(kernel.layer)}
      </p>
      {/* The ends of the leg the pulse is on are lit (ADR 0018). */}
      <p className="flow-path" data-testid="flow-path" data-leg={leg === null ? '' : String(leg)}>
        {FLOW_STAGES.map((stop, i) => (
          <span key={stop}>
            {i > 0 && ' → '}
            <span className={stopIsActive(leg, i) ? 'flow-stop-active' : undefined}>{stop}</span>
          </span>
        ))}
      </p>
      <p>
        Read from HBM: <Bytes q={kernel.bytes.hbmRead} testId="flow-bytes" />
      </p>
      <ul>
        {flowStreams(kernel).map((s) => (
          <li key={s.cls}>
            <span className="flow-swatch" style={{ background: FLOW_COLORS[s.cls] }} />
            {CLASS_LABELS[s.cls]}: <Bytes q={s.bytes} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
