// Store shape (design §6.1, ADR 0004).
import type { NavState } from '../nav/machine.ts';
import type { KernelRef } from '../plan/kernels.ts';
import type { KvDtype } from '../generated/KvDtype.ts';
import type { Phase } from '../generated/Phase.ts';
import type { StepPlan } from '../generated/StepPlan.ts';
import type { Weights } from '../generated/Weights.ts';

export type { StepPlan };
export type TimeMode = 'didactic' | 'real';

/**
 * The knobs the UI shows (design §6.8). The core takes a `Scenario` with one
 * context per request; `toScenario` (store.ts) expands these into one.
 */
export interface Knobs {
  batch: number;
  context: number;
  weights: Weights;
  kv: KvDtype;
  phase: Phase;
}

/** Calls the core's `evaluate`. Injected so the store has no hard dependency on WASM. */
export type Evaluate = (knobs: Knobs) => StepPlan;

export type Selection =
  | { kind: 'kernel'; index: number }
  | { kind: 'component'; id: string }
  | null;

export interface ScenarioSlice {
  scenario: Knobs;
  /** Merges the knobs, then re-evaluates the plan synchronously. */
  setScenario: (patch: Partial<Knobs>) => void;
}

export interface PlanSlice {
  plan: StepPlan | null;
  /** Last evaluation error message, or null. */
  planError: string | null;
  setEvaluator: (evaluate: Evaluate | null) => void;
}

export interface SelectionSlice {
  selection: Selection;
  select: (selection: Selection) => void;
}

export interface PlaybackSlice {
  /** Seconds along the timeline. Read with `getState()` inside `useFrame`. */
  playhead: number;
  speed: number;
  timeMode: TimeMode;
  playing: boolean;
  /** The layer shown kernel by kernel on the timeline; the others fold (design §6.5). */
  focusLayer: number | null;
  /**
   * The kernel the scene, the flow label and the panel show (ADR 0020). The
   * playback driver writes it from the playhead (`playback/driver.ts`).
   */
  sceneKernel: KernelRef;
  setSceneKernel: (ref: KernelRef) => void;
  setPlayhead: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  setTimeMode: (mode: TimeMode) => void;
  setPlaying: (playing: boolean) => void;
  setFocusLayer: (layer: number | null) => void;
}

export interface NavigationSlice extends NavState {
  /** Goes down into instance `instance` of the child `id`. Ignored on the path already or at the deepest level. */
  enter: (id: string, instance?: number) => void;
  /** Goes up one level; a no-op at the package. */
  back: () => void;
  /** Jumps to a prefix of the path (a breadcrumb click). */
  setPath: (path: string[]) => void;
  /** The scene calls this when the camera flight ends. */
  settle: () => void;
}

export type StoreState = ScenarioSlice &
  PlanSlice &
  SelectionSlice &
  PlaybackSlice &
  NavigationSlice;
