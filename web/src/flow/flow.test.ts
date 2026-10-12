import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, hardware, initCoreSync, type KernelPlan, type StepPlan } from '../core/index.ts';
import { layoutDie, nodeAtLevel, type Placement } from '../scene/layout.ts';
import { toScenario, DEFAULT_SCENARIO } from '../state/store.ts';
import {
  arrivalScale,
  findKernel,
  flowParticles,
  flowPaths,
  flowRoutes,
  flowStreams,
  formatBytes,
  formatBytesShort,
  legAt,
  logLevel,
  MAX_PARTICLES,
  MIN_PARTICLES,
  particleCount,
  pointAt,
  streamWidth,
  WAVE_SPREAD,
  waveLeg,
} from './flow.ts';
import { stopIsActive } from './stage.ts';

let plan: StepPlan;
let qkv: KernelPlan;
let dieParts: Placement[];

beforeAll(() => {
  initCoreSync(readFileSync(new URL('../wasm/gpuviz_wasm_bg.wasm', import.meta.url)));
  // The milestone's scenario (task 4.4): decode BF16, batch 1, 8k.
  plan = evaluate('h100-sxm', 'qwen3-8b', toScenario({ ...DEFAULT_SCENARIO, context: 8192 }));
  const found = findKernel(plan, 'qkv_proj');
  if (!found) throw new Error('the plan has no QKV GEMM');
  qkv = found;
  dieParts = layoutDie(nodeAtLevel(hardware('h100-sxm'), 'die'));
});

describe('the QKV GEMM in the plan', () => {
  it('is the GEMM of layer 0, alone in its kernel', () => {
    expect(qkv.name).toBe('aten::mm');
    expect(qkv.layer).toBe(0);
    expect(qkv.ops.map((o) => o.kind)).toEqual(['qkv_proj']);
    expect(findKernel(plan, 'qkv_proj', 35)?.layer).toBe(35);
    expect(findKernel(plan, 'qkv_quant')).toBeNull();
  });

  it('reads the Q, K and V weights and one hidden vector from HBM', () => {
    // hidden 4096 → 32 + 8 + 8 heads of 128, in BF16 (brief §8).
    const weights = 4096 * (32 + 8 + 8) * 128 * 2;
    const activations = 4096 * 2;
    expect(qkv.phaseBreakdown.read.weights.value).toBe(weights);
    expect(qkv.phaseBreakdown.read.activations.value).toBe(activations);
    expect(qkv.phaseBreakdown.read.kv.value).toBe(0);
    expect(qkv.bytes.hbmRead.value).toBe(weights + activations);
  });
});

describe('logarithmic scale', () => {
  it('maps 1 KB to 0 and 1 GB to 1, one sixth per decade', () => {
    expect(logLevel(0)).toBe(0);
    expect(logLevel(1e3)).toBe(0);
    expect(logLevel(1e6)).toBeCloseTo(0.5);
    expect(logLevel(1e9)).toBe(1);
    expect(logLevel(1e12)).toBe(1);
    expect(logLevel(1e7) - logLevel(1e6)).toBeCloseTo(1 / 6);
  });

  it('gives no particles to no bytes and at least a few to any bytes', () => {
    expect(particleCount(0)).toBe(0);
    expect(particleCount(1)).toBe(MIN_PARTICLES);
    expect(particleCount(1e9)).toBe(MAX_PARTICLES);
    const counts = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9].map(particleCount);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(counts.length);
  });

  it('widens the stream with the bytes', () => {
    expect(streamWidth(1e9)).toBeGreaterThan(streamWidth(1e3));
  });
});

describe('streams', () => {
  it('draws the weights and the activations of the QKV GEMM, not the KV it does not read', () => {
    const streams = flowStreams(qkv);
    expect(streams.map((s) => s.cls)).toEqual(['weights', 'activations']);
    const [weights, activations] = streams;
    // 6 000× the bytes, but only a few times the particles: the scale is log.
    expect(weights?.count).toBeGreaterThan(activations?.count ?? Infinity);
    expect((weights?.count ?? 0) / (activations?.count ?? 1)).toBeLessThan(10);
  });
});

describe('routes', () => {
  it('runs from each of the 10 active controllers to each of the 8 GPCs', () => {
    expect(flowRoutes(dieParts)).toHaveLength(10 * 8);
  });

  it('starts at an active controller and crosses the L2 half on its side', () => {
    const active = dieParts.filter((p) => p.kind === 'memory-controller' && p.enabled);
    const disabled = dieParts.filter((p) => p.kind === 'memory-controller' && !p.enabled);
    for (const [start, l2] of flowRoutes(dieParts)) {
      expect(active.some((p) => p.position[0] === start[0] && p.position[2] === start[2])).toBe(true);
      expect(disabled.some((p) => p.position[0] === start[0] && p.position[2] === start[2])).toBe(false);
      expect(Math.sign(l2[0])).toBe(Math.sign(start[0]));
    }
  });

  it('ends on an enabled SM, dropping onto it from a hub above its GPC', () => {
    const gpcs = dieParts.filter((p) => p.kind === 'gpc');
    const sms = dieParts.filter((p) => p.kind === 'sm');
    const landed = new Set<string>();
    for (const route of flowRoutes(dieParts)) {
      const [, , hub, end] = route;
      const sm = sms.find((p) => p.position[0] === end[0] && p.position[2] === end[2]);
      if (!sm) throw new Error('a route ends off every SM');
      expect(sm.enabled).toBe(true);
      expect(end[1]).toBeCloseTo(sm.position[1] + sm.size[1] / 2);
      const gpc = gpcs.find((g) => g.position[0] === hub[0] && g.position[2] === hub[2]);
      if (!gpc) throw new Error('a hub is above no GPC');
      expect(Math.abs(end[0] - gpc.position[0])).toBeLessThan(gpc.size[0] / 2);
      expect(Math.abs(end[2] - gpc.position[2])).toBeLessThan(gpc.size[2] / 2);
      expect(hub[1]).toBeGreaterThan(end[1]);
      landed.add(sm.key);
    }
    // Spread over each GPC's SMs, not all on one tile.
    expect(landed.size).toBeGreaterThan(gpcs.length * 3);
  });

  it('draws 26 shared legs: 10 controllers to their L2 half, 2 halves to 8 GPCs', () => {
    const paths = flowPaths(flowRoutes(dieParts));
    expect(paths).toHaveLength(10 + 2 * 8);
  });

  it('spends a third of the loop on each leg and hits every stop', () => {
    const route = flowRoutes(dieParts)[0];
    if (!route) throw new Error('no routes');
    expect(pointAt(route, 0)).toEqual(route[0]);
    for (const [s, stop] of [[1 / 3, route[1]], [2 / 3, route[2]], [1, route[3]]] as const) {
      pointAt(route, s).forEach((c, i) => { expect(c).toBeCloseTo(stop[i] ?? NaN); });
    }
    expect([0, 0.34, 0.67, 0.999, 1].map(legAt)).toEqual([0, 1, 2, 2, 2]);
  });

  it('keeps a particle whole until the last leg, then shrinks it to nothing', () => {
    expect(arrivalScale(0)).toBe(1);
    expect(arrivalScale(0.6)).toBe(1);
    expect(arrivalScale(5 / 6)).toBeCloseTo(0.5);
    expect(arrivalScale(1)).toBe(0);
  });
});

describe('particles', () => {
  it('gives every stream its count, on valid routes, all within one pulse', () => {
    const streams = flowStreams(qkv);
    const routes = flowRoutes(dieParts).length;
    const particles = flowParticles(streams, routes);
    expect(particles).toHaveLength(streams.reduce((n, s) => n + s.count, 0));
    expect(particles.every((p) => Number.isInteger(p.route) && p.route >= 0 && p.route < routes)).toBe(true);
    expect(particles.every((p) => p.phase >= 0 && p.phase < WAVE_SPREAD)).toBe(true);
    // Spread over the routes, not piled on a few.
    expect(new Set(particles.map((p) => p.route)).size).toBeGreaterThan(routes / 2);
    expect(flowParticles(streams, routes)).toEqual(particles);
  });

  it('keeps each particle within its stream width', () => {
    const streams = flowStreams(qkv);
    for (const p of flowParticles(streams, 80)) {
      const width = streams.find((s) => s.cls === p.cls)?.width ?? 0;
      expect(p.offset.every((c) => Math.abs(c) <= width / 2)).toBe(true);
    }
  });
});

describe('waves', () => {
  it('puts the pulse on one leg at a time, in order, and loops', () => {
    // Sampled from the pulse's center, one full loop.
    const legs = Array.from({ length: 30 }, (_, i) => waveLeg(i / 30 - WAVE_SPREAD / 2));
    // Each leg shows up as one run, in order: 0, 1, 2.
    const runs = legs.filter((l, i) => i === 0 || l !== legs[i - 1]);
    expect(runs).toEqual([0, 1, 2]);
    expect(waveLeg(1.5)).toBe(waveLeg(0.5));
  });

  it('lights the two ends of the current leg and nothing without a flow', () => {
    expect([0, 1, 2, 3].map((stop) => stopIsActive(1, stop))).toEqual([false, true, true, false]);
    expect(stopIsActive(null, 0)).toBe(false);
  });
});

describe('labels', () => {
  it('shows the exact count and a rounded one', () => {
    expect(formatBytes(50339840)).toBe('50,339,840 B');
    expect(formatBytesShort(50339840)).toBe('50.3 MB');
    expect(formatBytesShort(8192)).toBe('8.2 KB');
    expect(formatBytesShort(512)).toBe('512 B');
  });
});
