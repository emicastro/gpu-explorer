// Store shape (design §6.1, ADR 0004).
// `Scenario` and `StepPlan` are local stand-ins until the core's generated types land
// (task 3.2 / ADR 0001); then these aliases become re-exports from ../generated.

export type WeightsScheme = 'bf16' | 'fp8_block' | 'fp8_tensor' | 'fp8_w8a16';
export type Phase = 'prefill' | 'decode';
export type KvDtype = 'bf16' | 'fp8';
export type TimeMode = 'didactic' | 'real';

export interface Scenario {
  batch: number;
  context: number;
  weights: WeightsScheme;
  kv: KvDtype;
  phase: Phase;
}

/** Opaque until the core exposes the generated `StepPlan`. */
export type StepPlan = object;

/** Calls the core's `evaluate`. Injected so the store has no hard dependency on WASM. */
export type Evaluate = (scenario: Scenario) => StepPlan;

export type Selection =
  | { kind: 'kernel'; index: number }
  | { kind: 'component'; id: string }
  | null;

export interface ScenarioSlice {
  scenario: Scenario;
  /** Merges the knobs, then re-evaluates the plan synchronously. */
  setScenario: (patch: Partial<Scenario>) => void;
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
  setPlayhead: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  setTimeMode: (mode: TimeMode) => void;
  setPlaying: (playing: boolean) => void;
}

export interface NavigationSlice {
  /** Hardware-tree node ids from the root to the current level. */
  path: string[];
  enter: (id: string) => void;
  /** Goes up one level; a no-op at the root. */
  back: () => void;
  setPath: (path: string[]) => void;
}

export type StoreState = ScenarioSlice &
  PlanSlice &
  SelectionSlice &
  PlaybackSlice &
  NavigationSlice;
