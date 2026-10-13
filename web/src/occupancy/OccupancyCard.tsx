import { useMemo } from 'react';
import type { HwNode, KernelPlan, Quantity, StepPlan } from '../core/index.ts';
import { kernelLabel, kernelPlace, refOf, sameRef, sceneKernel, type KernelRef } from '../plan/kernels.ts';
import { seekToKernel } from '../playback/driver.ts';
import { nodeAtLevel } from '../scene/layout.ts';
import { partColor, SM_BUSY_COLOR, smOccupancyColor } from '../scene/palette.ts';
import { Num } from '../quantity/Num.tsx';
import { Q } from '../quantity/Q.tsx';
import { useStore } from '../state/store.ts';
import { busySmKeys, smOccupancy, smSlots, splitKv, waveCount, type SplitKv } from './occupancy.ts';
import { clampWave, useWave } from './wave.ts';

/** The grid of blocks is drawn only while it stays small enough to read. */
const MAX_GRID_ROWS = 16;

/** The kernels the picker offers: layer 0's, and the ones outside the layer loop. */
function pickable(plan: StepPlan): { kernel: KernelPlan; ref: KernelRef; label: string }[] {
  const kernels = plan.kernels.filter((k) => k.layer === null || k.layer === 0);
  const labels = kernels.map((k) => `${kernelLabel(k)} · ${kernelPlace(k)}`);
  return kernels.map((kernel, i) => {
    const label = labels[i] ?? '';
    const same = labels.filter((l) => l === label).length;
    const nth = labels.slice(0, i).filter((l) => l === label).length;
    return { kernel, ref: refOf(plan, kernel), label: same > 1 ? `${label} (${String(nth + 1)} of ${String(same)})` : label };
  });
}

const refKey = (ref: KernelRef): string => `${ref.op.kind}@${String(ref.op.layer)}#${String(ref.nth)}`;

/** The blocks of a split decode attention: a row per (request, KV head), a cell per split. */
function SplitKvLesson({ split, kernel, kvHeads, oneWave }: { split: SplitKv; kernel: KernelPlan; kvHeads: Quantity; oneWave: boolean }) {
  const rows = split.requests * split.kvHeads;
  return (
    <section className="occupancy-split" data-testid="split-kv">
      <h3>Split-KV</h3>
      <p>
        {split.requests !== 1 && <><Num value={split.requests} /> requests × </>}
        <Q value={kvHeads} /> KV heads × <strong><Q value={kernel.grid.splits} /></strong>{' '}
        {split.splits === 1 ? 'split' : 'splits'} = <strong data-testid="split-kv-blocks"><Q value={kernel.grid.blocks} /></strong> blocks
      </p>
      {oneWave && rows <= MAX_GRID_ROWS && (
        <div
          className="occupancy-grid"
          style={{ gridTemplateColumns: `repeat(${String(split.splits)}, 10px)` }}
          role="img"
          aria-label={`${String(rows)} rows of ${String(split.splits)} blocks`}
        >
          {Array.from({ length: split.blocks }, (_, i) => (
            <span key={i} style={{ background: SM_BUSY_COLOR }} />
          ))}
        </div>
      )}
      {split.splits > 1 ? (
        <p className="occupancy-note">
          Without the split, <Num value={rows} /> blocks would keep <Num value={rows} /> of the SMs busy. Each block reads 1/
          <Q value={kernel.grid.splits} /> of its head&apos;s KV cache; the next kernel, the combine, merges the partial results.
        </p>
      ) : (
        <p className="occupancy-note">No split: the batch&apos;s own blocks already cover the SMs.</p>
      )}
    </section>
  );
}

/**
 * Which SMs the scene's kernel occupies in the current wave (design §6.6, R11),
 * and a kernel picker that moves the playhead. Shown
 * on the die and GPC levels, where the SMs light up.
 */
export function OccupancyCard({ hardware, kvHeads }: { hardware: HwNode; kvHeads: Quantity }) {
  const plan = useStore((s) => s.plan);
  const ref = useStore((s) => s.sceneKernel);
  const scenario = useStore((s) => s.scenario);
  const path = useStore((s) => s.path);
  const picks = useStore((s) => s.picks);
  const settled = useStore((s) => s.from === null);
  const ticked = useWave((s) => s.wave);
  const slots = useMemo(() => smSlots(nodeAtLevel(hardware, 'die')), [hardware]);
  const options = useMemo(() => (plan ? pickable(plan) : []), [plan]);

  const kernel = plan ? sceneKernel(plan, ref) : null;
  if (!plan || !kernel || !settled || (path.length !== 1 && path.length !== 2)) return null;
  const waves = waveCount(kernel);
  const wave = clampWave(ticked, waves);
  const busy = smOccupancy(kernel, wave, slots.length);
  const gpcId = path[1];
  const inGpc = gpcId ? busySmKeys(slots, busy, { gpcId, gpc: picks[1] ?? 0 }).size : null;
  const gpcSms = gpcId ? slots.filter((s) => s.gpcId === gpcId && s.gpc === (picks[1] ?? 0)).length : 0;
  const split = splitKv(kernel, scenario.batch, kvHeads.value);
  // The ref may have fallen back to the default kernel: the picker shows the one on the scene.
  const shown = refOf(plan, kernel);
  const current = options.find((o) => sameRef(o.ref, shown));

  return (
    <aside className="occupancy-card" aria-label="SM occupancy" data-testid="occupancy">
      <label className="occupancy-picker">
        Kernel{' '}
        <select
          value={current ? refKey(current.ref) : ''}
          onChange={(e) => {
            const picked = options.find((o) => refKey(o.ref) === e.target.value);
            if (picked) seekToKernel(picked.ref);
          }}
        >
          {options.map((o) => (
            <option key={refKey(o.ref)} value={refKey(o.ref)}>{o.label}</option>
          ))}
        </select>
      </label>
      <p>
        <code>{kernel.name}</code> · <Q value={kernel.grid.blocks} /> blocks in <Q value={kernel.grid.waves} />{' '}
        {waves === 1 ? 'wave' : 'waves'}
      </p>
      <p>
        Wave <span data-testid="occupancy-wave"><Num value={wave + 1} /></span> of <Num value={waves} />:{' '}
        <strong data-testid="occupancy-busy"><Num value={busy.size} /></strong> of <Num value={slots.length} /> SMs busy
        (<Num value={Math.round((100 * busy.size) / slots.length)} />%)
      </p>
      {inGpc !== null && (
        <p>
          In this GPC: <strong data-testid="occupancy-gpc-busy"><Num value={inGpc} /></strong> of <Num value={gpcSms} />
        </p>
      )}
      <ul className="occupancy-legend">
        <li><span style={{ background: smOccupancyColor(true) }} /> busy</li>
        <li><span style={{ background: smOccupancyColor(false) }} /> idle</li>
        <li><span style={{ background: partColor('sm', false) }} /> fused off</li>
      </ul>
      {split && <SplitKvLesson split={split} kernel={kernel} kvHeads={kvHeads} oneWave={waves === 1} />}
      {kernel.impl === 'fa3_combine' && (
        <p className="occupancy-note">
          Merges the partial results of the attention&apos;s <Q value={kernel.grid.splits} /> splits into one
          output per head.
        </p>
      )}
    </aside>
  );
}
