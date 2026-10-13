import { create } from 'zustand';

/**
 * The wave of the scene's kernel that the SMs show: animation state, kept
 * apart from the app store and written only when the wave changes, like the
 * flow's leg (flow/stage.ts). The playback driver sets it from the playhead
 * (ADR 0020).
 */
interface WaveState {
  wave: number;
  setWave: (wave: number) => void;
}

export const useWave = create<WaveState>((set) => ({
  wave: 0,
  setWave: (wave) => { set({ wave }); },
}));

/** Seconds of one pulse of the flow from the HBM to a tensor core (scene/Flow.tsx). */
export const WAVE_SECONDS = 4.5;

/** A wave index that fits the kernel, for the moment between a kernel change and the clock's reset. */
export const clampWave = (wave: number, waves: number): number => Math.min(Math.max(wave, 0), Math.max(waves - 1, 0));
