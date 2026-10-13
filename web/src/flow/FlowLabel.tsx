import { FLOW_COLORS, type TrafficClass } from '../scene/palette.ts';
import { useStore } from '../state/store.ts';
import { kernelLabel, kernelPlace, sceneSubject } from '../plan/kernels.ts';
import { Num } from '../quantity/Num.tsx';
import { Q } from '../quantity/Q.tsx';
import { FLOW_STAGES, flowStreams } from './flow.ts';
import { stopIsActive, useFlowStage } from './stage.ts';

const CLASS_LABELS: Record<TrafficClass, string> = {
  weights: 'Weights',
  kv: 'KV cache',
  activations: 'Activations',
};

/** What the particles on the die stand for, with the exact bytes of the plan (R11). */
export function FlowLabel() {
  const plan = useStore((s) => s.plan);
  const atDie = useStore((s) => s.path.length === 1 && s.from === null);
  const ref = useStore((s) => s.sceneKernel);
  const summary = useStore((s) => s.summary);
  const leg = useFlowStage((s) => s.leg);
  const kernel = plan && atDie ? sceneSubject(plan, ref, summary) : null;
  if (!kernel) return null;
  return (
    <aside className="flow-label" aria-label="Data flow">
      {summary ? (
        <p className="flow-kernel" data-testid="flow-summary">
          <strong>Layer <Num value={summary.layer} />, all its kernels together.</strong>{' '}
          {summary.why === 'folded'
            ? 'This layer is folded: it flies by too fast to show kernel by kernel. Pick it in the Layer selector to see each kernel.'
            : 'This kernel is too short to see at real time. Set Time to Didactic to see each kernel.'}
        </p>
      ) : (
        <p className="flow-kernel">
          <code>{kernel.name}</code> · {kernelLabel(kernel)} · {kernelPlace(kernel)}
        </p>
      )}
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
        Read from HBM: <Q value={kernel.bytes.hbmRead} testId="flow-bytes" />
      </p>
      <ul>
        {flowStreams(kernel).map((s) => (
          <li key={s.cls}>
            <span className="flow-swatch" style={{ background: FLOW_COLORS[s.cls] }} />
            {CLASS_LABELS[s.cls]}: <Q value={s.bytes} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
