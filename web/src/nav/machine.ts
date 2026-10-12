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
  /** The path we are flying away from, or null when settled. */
  from: string[] | null;
}

export type NavEvent =
  | { type: 'enter'; id: string }
  | { type: 'back' }
  | { type: 'goto'; path: string[] }
  | { type: 'settle' };

export const INITIAL_NAV: NavState = { path: [], from: null };

const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Moves to `path`. A change while flying restarts the flight from the old target. */
function moveTo(state: NavState, path: string[]): NavState {
  return samePath(state.path, path) ? state : { path, from: state.path };
}

export function navReduce(state: NavState, event: NavEvent): NavState {
  switch (event.type) {
    case 'enter':
      // Already on the path, or already at the deepest level: nothing to enter.
      if (state.path.length >= MAX_DEPTH || state.path.includes(event.id)) return state;
      return moveTo(state, [...state.path, event.id]);
    case 'back':
      return state.path.length === 0 ? state : moveTo(state, state.path.slice(0, -1));
    case 'goto':
      return moveTo(state, event.path.slice(0, MAX_DEPTH));
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
