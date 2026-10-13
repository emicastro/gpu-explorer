// Moves the playhead and keeps the scene's kernel and wave in step with it
// (ADR 0020). The store holds the playhead; this is the only writer of
// `sceneKernel` besides a seek.
import { useEffect } from 'react';
import { useWave } from '../occupancy/wave.ts';
import { waveCount } from '../occupancy/occupancy.ts';
import { refOf, sameRef, type KernelRef } from '../plan/kernels.ts';
import { useStore } from '../state/store.ts';
import { advance, kernelAt, kernelIndex, startOfKernel, timelineFor, waveAtProgress } from './playback.ts';

/** Writes the kernel and wave the playhead is on into the store. */
function syncScene(): void {
  const { plan, playhead, timeMode, focusLayer, sceneKernel, setSceneKernel } = useStore.getState();
  if (!plan) return;
  const under = kernelAt(plan, timelineFor(plan, timeMode, focusLayer), playhead);
  const kernel = under && plan.kernels[under.index];
  if (!under || !kernel) return;
  const ref = refOf(plan, kernel);
  if (!sameRef(ref, sceneKernel)) setSceneKernel(ref);
  const wave = waveAtProgress(under.progress, waveCount(kernel));
  if (useWave.getState().wave !== wave) useWave.getState().setWave(wave);
}

/** Puts the playhead at the start of the kernel `ref` names; focuses its layer if it is folded. */
export function seekToKernel(ref: KernelRef): void {
  const { plan, timeMode, focusLayer, setSceneKernel, setFocusLayer, setPlayhead } = useStore.getState();
  if (!plan) return;
  const index = kernelIndex(plan, ref);
  const layer = plan.kernels[index]?.layer ?? null;
  setSceneKernel(ref);
  if (layer !== null && layer !== focusLayer) {
    // The axis changes; the driver re-anchors the playhead on `sceneKernel`.
    setFocusLayer(layer);
    return;
  }
  setPlayhead(startOfKernel(plan, timelineFor(plan, timeMode, focusLayer), index));
}

/** Focuses `layer` and puts the playhead at its first kernel. */
export function seekToLayer(layer: number): void {
  const { plan } = useStore.getState();
  const span = plan?.layers.find((l) => l.layer === layer);
  const first = plan && span && plan.kernels[span.start];
  if (!plan || !first) return;
  seekToKernel(refOf(plan, first));
  // Already the focused layer: seekToKernel moved the playhead to the kernel it was asked for.
}

/** Mount once. Plays the step while `playing`, and keeps the scene on the playhead. */
export function usePlaybackDriver(): void {
  const playing = useStore((s) => s.playing);
  const plan = useStore((s) => s.plan);
  const timeMode = useStore((s) => s.timeMode);
  const focusLayer = useStore((s) => s.focusLayer);

  // The axis changed (new plan, mode or focus): the playhead stays on the scene's kernel.
  useEffect(() => {
    const s = useStore.getState();
    if (!s.plan) return;
    const segments = timelineFor(s.plan, s.timeMode, s.focusLayer);
    s.setPlayhead(startOfKernel(s.plan, segments, kernelIndex(s.plan, s.sceneKernel)));
    syncScene();
  }, [plan, timeMode, focusLayer]);

  // A scrub or a tick moved the playhead.
  useEffect(
    () =>
      useStore.subscribe((state, prev) => {
        if (state.playhead !== prev.playhead) syncScene();
      }),
    [],
  );

  useEffect(() => {
    if (!playing) return;
    let last: number | null = null;
    let frame = 0;
    const tick = (now: number): void => {
      const { plan: p, timeMode: mode, focusLayer: focus, playhead, speed, playing: on, setPlayhead, setPlaying } = useStore.getState();
      // A frame already queued when Pause lands must not move the playhead.
      if (!p || !on) return;
      const segments = timelineFor(p, mode, focus);
      const end = segments.length ? (segments.at(-1)?.start ?? 0) + (segments.at(-1)?.duration ?? 0) : 0;
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      // Playing from the end starts over.
      const from = playhead >= end ? 0 : playhead;
      const next = advance(from, dt, speed, end);
      setPlayhead(next.t);
      if (next.ended) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); };
  }, [playing]);
}
