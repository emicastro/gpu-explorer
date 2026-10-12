import { create, type StateCreator } from 'zustand';
import { INITIAL_NAV, navReduce, type NavEvent } from '../nav/machine.ts';
import type { Scenario } from '../generated/Scenario.ts';
import type {
  Evaluate,
  Knobs,
  NavigationSlice,
  PlanSlice,
  PlaybackSlice,
  ScenarioSlice,
  SelectionSlice,
  StoreState,
} from './types.ts';

export const DEFAULT_SCENARIO: Knobs = {
  batch: 1,
  context: 1024,
  weights: 'bf16',
  kv: 'bf16',
  phase: 'decode',
};

/**
 * The core's scenario for the knobs: `batch` requests of the same context
 * (brief D9). Decode adds one token per request; prefill, the whole prompt.
 */
export function toScenario(knobs: Knobs): Scenario {
  return {
    phase: knobs.phase,
    contexts: Array<number>(knobs.batch).fill(knobs.context),
    newTokens: knobs.phase === 'decode' ? 1 : knobs.context,
    weights: knobs.weights,
    kv: knobs.kv,
  };
}

// The evaluator lives outside the state: it is a dependency, not data to render.
let evaluator: Evaluate | null = null;

type Slice<T> = StateCreator<StoreState, [], [], T>;

function runEvaluate(scenario: Knobs): Pick<PlanSlice, 'plan' | 'planError'> {
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

const navigationSlice: Slice<NavigationSlice> = (set, get) => {
  const send = (event: NavEvent) => {
    const { path, from } = get();
    const next = navReduce({ path, from }, event);
    if (next.path !== path || next.from !== from) set(next);
  };
  return {
    ...INITIAL_NAV,
    enter: (id) => { send({ type: 'enter', id }); },
    back: () => { send({ type: 'back' }); },
    setPath: (path) => { send({ type: 'goto', path }); },
    settle: () => { send({ type: 'settle' }); },
  };
};

export const useStore = create<StoreState>()((...a) => ({
  ...scenarioSlice(...a),
  ...planSlice(...a),
  ...selectionSlice(...a),
  ...playbackSlice(...a),
  ...navigationSlice(...a),
}));
