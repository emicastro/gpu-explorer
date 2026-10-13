import { useStore } from '../state/store.ts';
import type { TimeMode } from '../state/types.ts';
import {
  BATCH_MAX, CONTEXT_MAX, fromSlider, KV_OPTIONS, pick, PHASE_OPTIONS, STEPS, toSlider,
  WEIGHT_OPTIONS, YARN_FROM,
} from './knobs.ts';

/** The scenario knobs and the mode of time (design §6.8, R13). Each change re-evaluates. */
export function KnobsPanel() {
  const knobs = useStore((s) => s.scenario);
  const setScenario = useStore((s) => s.setScenario);
  const mode = useStore((s) => s.timeMode);
  const setTimeMode = useStore((s) => s.setTimeMode);
  const planError = useStore((s) => s.planError);
  const yarn = knobs.context > YARN_FROM;
  const decode = knobs.phase === 'decode';

  return (
    <section className="knobs" aria-label="Scenario knobs" data-testid="knobs">
      <label className="knob">
        <span>Phase</span>
        <select
          aria-label="Phase"
          value={knobs.phase}
          onChange={(e) => {
            const phase = pick(PHASE_OPTIONS, e.target.value);
            if (phase) setScenario({ phase });
          }}
        >
          {PHASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <div className="knob">
        <label htmlFor="knob-batch">Batch</label>
        <input
          id="knob-batch"
          type="range"
          min={0}
          max={STEPS}
          value={toSlider(knobs.batch, BATCH_MAX)}
          aria-valuetext={`${String(knobs.batch)} requests`}
          onChange={(e) => { setScenario({ batch: fromSlider(Number(e.target.value), BATCH_MAX) }); }}
        />
        <output htmlFor="knob-batch">{knobs.batch}</output>
      </div>
      <div className="knob">
        <label htmlFor="knob-context">{decode ? 'Context' : 'Prompt'}</label>
        <div className="knob-slider">
          <input
            id="knob-context"
            type="range"
            min={0}
            max={STEPS}
            value={toSlider(knobs.context, CONTEXT_MAX)}
            aria-valuetext={`${String(knobs.context)} tokens`}
            onChange={(e) => { setScenario({ context: fromSlider(Number(e.target.value), CONTEXT_MAX) }); }}
          />
          <span
            className="knob-mark"
            aria-hidden="true"
            style={{ left: `${(100 * toSlider(YARN_FROM, CONTEXT_MAX) / STEPS).toFixed(2)}%` }}
          />
        </div>
        <output htmlFor="knob-context">{knobs.context}</output>
      </div>
      {yarn && (
        <p className="knob-note" data-testid="yarn-note">
          Past 32k tokens this model needs YaRN. Compute cost and KV size are the same.
        </p>
      )}
      <label className="knob">
        <span>Weights</span>
        <select
          aria-label="Weights"
          value={knobs.weights}
          onChange={(e) => {
            const weights = pick(WEIGHT_OPTIONS, e.target.value);
            if (weights) setScenario({ weights });
          }}
        >
          {WEIGHT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="knob">
        <span>KV cache</span>
        <select
          aria-label="KV cache"
          value={knobs.kv}
          onChange={(e) => {
            const kv = pick(KV_OPTIONS, e.target.value);
            if (kv) setScenario({ kv });
          }}
        >
          {KV_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="knob">
        <span>Time</span>
        <select
          aria-label="Time"
          value={mode}
          onChange={(e) => {
            const next: TimeMode = e.target.value === 'real' ? 'real' : 'didactic';
            setTimeMode(next);
          }}
        >
          <option value="didactic">Didactic</option>
          <option value="real">Real (proportional)</option>
        </select>
      </label>
      {planError && <p className="knob-note knob-error" role="alert">{planError}</p>}
    </section>
  );
}
