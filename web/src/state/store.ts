import { create, type StateCreator } from 'zustand';
import type {
  Evaluate,
  NavigationSlice,
  PlanSlice,
  PlaybackSlice,
  Scenario,
  ScenarioSlice,
  SelectionSlice,
  StoreState,
} from './types.ts';

export const DEFAULT_SCENARIO: Scenario = {
  batch: 1,
  context: 1024,
  weights: 'bf16',
  kv: 'bf16',
  phase: 'decode',
};

// The evaluator lives outside the state: it is a dependency, not data to render.
let evaluator: Evaluate | null = null;

type Slice<T> = StateCreator<StoreState, [], [], T>;

function runEvaluate(scenario: Scenario): Pick<PlanSlice, 'plan' | 'planError'> {
  if (!evaluator) return { plan: null, planError: null };
  try {
    return { plan: evaluator(scenario), planError: null };
  } catch (e) {
    return { plan: null, planError: e instanceof Error ? e.message : String(e) };
  }
}

const scenarioSlice: Slice<ScenarioSlice> = (set, get) => ({
  scenario: DEFAULT_SCENARIO,
  setScenario: (patch) => {
    const scenario = { ...get().scenario, ...patch };
    set({ scenario, ...runEvaluate(scenario) });
  },
});

const planSlice: Slice<PlanSlice> = (set, get) => ({
  plan: null,
  planError: null,
  setEvaluator: (evaluate) => {
    evaluator = evaluate;
    set(runEvaluate(get().scenario));
  },
});

const selectionSlice: Slice<SelectionSlice> = (set) => ({
  selection: null,
  select: (selection) => { set({ selection }); },
});

const playbackSlice: Slice<PlaybackSlice> = (set) => ({
  playhead: 0,
  speed: 1,
  timeMode: 'didactic',
  playing: false,
  setPlayhead: (playhead) => { set({ playhead }); },
  setSpeed: (speed) => { set({ speed }); },
  setTimeMode: (timeMode) => { set({ timeMode }); },
  setPlaying: (playing) => { set({ playing }); },
});

const navigationSlice: Slice<NavigationSlice> = (set, get) => ({
  path: [],
  enter: (id) => { set({ path: [...get().path, id] }); },
  back: () => { set({ path: get().path.slice(0, -1) }); },
  setPath: (path) => { set({ path }); },
});

export const useStore = create<StoreState>()((...a) => ({
  ...scenarioSlice(...a),
  ...planSlice(...a),
  ...selectionSlice(...a),
  ...playbackSlice(...a),
  ...navigationSlice(...a),
}));
