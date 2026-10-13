import { useMemo } from 'react';
import { kernelLabel, refOf } from '../plan/kernels.ts';
import { kernelIndex } from '../playback/playback.ts';
import { seekToKernel } from '../playback/driver.ts';
import { useStore } from '../state/store.ts';
import { decadeRange, logFrac, roofPoints } from './roofline.ts';

const W = 288;
const H = 170;
const PAD = { l: 34, r: 8, t: 8, b: 22 };

const decades = (r: { min: number; max: number }): number[] => {
  const out: number[] = [];
  for (let v = r.min; v <= r.max * 1.0001; v *= 10) out.push(v);
  return out;
};
const tick = (v: number): string => (v >= 1e12 ? `${String(v / 1e12)}T` : v >= 1e9 ? `${String(v / 1e9)}G` : v >= 1e6 ? `${String(v / 1e6)}M` : String(v));

/** Log-log roofline: a point per kernel, the memory slope and the BF16 and FP8 ceilings (design §6.8). */
export function Roofline() {
  const plan = useStore((s) => s.plan);
  const scene = useStore((s) => s.sceneKernel);
  const geo = useMemo(() => {
    if (!plan) return null;
    const points = roofPoints(plan);
    if (!points.length) return null;
    const { bf16Peak, fp8Peak, hbmBandwidth } = plan.roofs;
    const bw = hbmBandwidth.value;
    const xr = decadeRange([...points.map((p) => p.intensity), bf16Peak.value / bw / 10, fp8Peak.value / bw * 10]);
    const yr = decadeRange([...points.map((p) => p.perf), fp8Peak.value]);
    const x = (v: number): number => PAD.l + logFrac(v, xr) * (W - PAD.l - PAD.r);
    const y = (v: number): number => H - PAD.b - logFrac(v, yr) * (H - PAD.t - PAD.b);
    return { points, xr, yr, x, y, bw, bf16: bf16Peak.value, fp8: fp8Peak.value };
  }, [plan]);
  if (!plan || !geo) return null;
  const { x, y, xr, yr, bw, bf16, fp8 } = geo;
  const active = kernelIndex(plan, scene);
  // The slope y = bw·x meets the FP8 ceiling last; clip it to the axes.
  const xEnd = Math.min(xr.max, fp8 / bw);
  const xStart = Math.max(xr.min, yr.min / bw);
  const selected = geo.points.find((p) => p.index === active);

  return (
    <section className="roofline" aria-label="Roofline" data-testid="roofline">
      <h3>Roofline</h3>
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Kernels by arithmetic intensity and attained FLOP/s">
        {decades(xr).map((v) => (
          <g key={`x${String(v)}`} className="roof-grid">
            <line x1={x(v)} x2={x(v)} y1={PAD.t} y2={H - PAD.b} />
            <text x={x(v)} y={H - 8} textAnchor="middle">{tick(v)}</text>
          </g>
        ))}
        {decades(yr).map((v) => (
          <g key={`y${String(v)}`} className="roof-grid">
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end">{tick(v)}</text>
          </g>
        ))}
        <line className="roof-line" x1={x(xStart)} y1={y(bw * xStart)} x2={x(xEnd)} y2={y(bw * xEnd)} />
        <line className="roof-line roof-fp8" x1={x(fp8 / bw)} x2={x(xr.max)} y1={y(fp8)} y2={y(fp8)} />
        <line className="roof-line roof-bf16" x1={x(bf16 / bw)} x2={x(xr.max)} y1={y(bf16)} y2={y(bf16)} />
        <text className="roof-name" x={W - PAD.r} y={y(bf16) + 10} textAnchor="end">BF16</text>
        <text className="roof-name" x={W - PAD.r} y={y(fp8) - 3} textAnchor="end">FP8</text>
        {geo.points.map((p) => {
          const k = plan.kernels[p.index];
          if (!k || p.index === active) return null;
          return (
            <circle
              key={p.index}
              className={`roof-point roof-point-${k.bound}`}
              cx={x(p.intensity)}
              cy={y(p.perf)}
              r={2.5}
              onClick={() => { seekToKernel(refOf(plan, k)); }}
            >
              <title>{kernelLabel(k)}</title>
            </circle>
          );
        })}
        {selected && (
          <circle
            className="roof-point roof-point-selected"
            data-testid="roofline-selected"
            data-kernel={plan.kernels[selected.index]?.id}
            cx={x(selected.intensity)}
            cy={y(selected.perf)}
            r={5}
          >
            <title>{(() => { const k = plan.kernels[selected.index]; return k ? kernelLabel(k) : ''; })()}</title>
          </circle>
        )}
      </svg>
      <p className="roof-axes">FLOP/byte → · FLOP/s ↑</p>
    </section>
  );
}
