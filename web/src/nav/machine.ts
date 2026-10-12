// Level state machine (design §6.2, R7). Pure: the store applies these and
// the scene reads the result. The path is relative to the package, which is
// the root view: [] = package, ['die'] = die, and so on down to the
// sub-partition.

/** Levels the user can be at, in order: package → die → GPC → SM → sub-partition. */
export const LEVEL_LABELS = ['Package', 'Die', 'GPC', 'SM', 'Sub-partition'] as const;
export const MAX_DEPTH = LEVEL_LABELS.length - 1;

export interface NavState {
  /** Hardware-tree node ids below the package, down to the current level. */
  path: string[];
  /** Which instance of each node on the path (ADR 0019); same length as `path`. */
  picks: number[];
  /** The path we are flying away from, or null when settled. */
  from: string[] | null;
}

export type NavEvent =
  | { type: 'enter'; id: string; instance?: number }
  | { type: 'back' }
  | { type: 'goto'; path: string[] }
  | { type: 'settle' };

export const INITIAL_NAV: NavState = { path: [], picks: [], from: null };

const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Moves to `path` with `picks`. A change while flying restarts the flight from the old target. */
function moveTo(state: NavState, path: string[], picks: number[]): NavState {
  return sameList(state.path, path) && sameList(state.picks, picks) ? state : { path, picks, from: state.path };
}

export function navReduce(state: NavState, event: NavEvent): NavState {
  switch (event.type) {
    case 'enter':
      // Already on the path, or already at the deepest level: nothing to enter.
      if (state.path.length >= MAX_DEPTH || state.path.includes(event.id)) return state;
      return moveTo(state, [...state.path, event.id], [...state.picks, event.instance ?? 0]);
    case 'back':
      return state.path.length === 0
        ? state
        : moveTo(state, state.path.slice(0, -1), state.picks.slice(0, -1));
    case 'goto': {
      const path = event.path.slice(0, MAX_DEPTH);
      // Picks survive only where the new path agrees with the old one.
      let agree = true;
      const picks = path.map((id, i) => {
        agree = agree && state.path[i] === id;
        return agree ? (state.picks[i] ?? 0) : 0;
      });
      return moveTo(state, path, picks);
    }
    case 'settle':
      return state.from === null ? state : { ...state, from: null };
  }
}

/** The label of the level the path ends at. */
export function levelLabel(depth: number): string {
  return LEVEL_LABELS[Math.min(depth, MAX_DEPTH)] ?? 'Package';
}

export interface Crumb {
  label: string;
  /** The path that clicking this crumb goes to. */
  path: string[];
  current: boolean;
}

/** One crumb per level from the package to the current one. */
export function breadcrumbs(path: string[]): Crumb[] {
  return Array.from({ length: path.length + 1 }, (_, depth) => ({
    label: levelLabel(depth),
    path: path.slice(0, depth),
    current: depth === path.length,
  }));
}

/**
 * What is physical and what is logical, for the levels where a warp could be
 * mistaken for a block of silicon (brief §4.1). Null where there is nothing to add.
 */
export function levelNote(depth: number): string | null {
  switch (depth) {
    case 3:
      return 'Physical: 4 sub-partitions, plus the L1 / shared memory and the TMA that all of them share. A warp is not here: it is 32 threads that execute together, scheduled on one sub-partition.';
    case 4:
      return 'Everything drawn is silicon. A warp is logical: 32 threads the scheduler issues together, one instruction at a time, to these units.';
    default:
      return null;
  }
}
