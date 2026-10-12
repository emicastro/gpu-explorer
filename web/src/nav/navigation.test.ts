import { describe, expect, it } from 'vitest';
import { breadcrumbs, INITIAL_NAV, levelNote, MAX_DEPTH, navReduce, type NavState } from './machine.ts';

const enter = (s: NavState, id: string) => navReduce(s, { type: 'enter', id });
const back = (s: NavState) => navReduce(s, { type: 'back' });

describe('navigation state machine', () => {
  it('starts at the package, settled', () => {
    expect(INITIAL_NAV).toEqual({ path: [], picks: [], from: null });
  });

  it('enter goes one level down and records where it came from', () => {
    const s = enter(INITIAL_NAV, 'die');
    expect(s).toEqual({ path: ['die'], picks: [0], from: [] });
    expect(navReduce(s, { type: 'settle' })).toEqual({ path: ['die'], picks: [0], from: null });
  });

  it('back goes up one level and is a no-op at the package', () => {
    const settled = navReduce(enter(INITIAL_NAV, 'die'), { type: 'settle' });
    expect(back(settled)).toEqual({ path: [], picks: [], from: ['die'] });
    expect(back(INITIAL_NAV)).toBe(INITIAL_NAV);
  });

  it('ignores an id already on the path and entries past the deepest level', () => {
    const s = enter(INITIAL_NAV, 'die');
    expect(enter(s, 'die')).toBe(s);
    let deep: NavState = INITIAL_NAV;
    for (let i = 0; i < MAX_DEPTH + 2; i++) deep = enter(deep, `level-${String(i)}`);
    expect(deep.path).toHaveLength(MAX_DEPTH);
  });

  it('retargets from the old path when the user navigates mid-flight', () => {
    const flying = enter(INITIAL_NAV, 'die');
    expect(back(flying)).toEqual({ path: [], picks: [], from: ['die'] });
  });

  it('goto jumps to a prefix (a crumb click) and ignores the current path', () => {
    const deep = enter(enter(INITIAL_NAV, 'die'), 'gpc');
    expect(navReduce(deep, { type: 'goto', path: [] })).toEqual({ path: [], picks: [], from: ['die', 'gpc'] });
    expect(navReduce(deep, { type: 'goto', path: ['die', 'gpc'] })).toBe(deep);
  });

  it('settle on a settled state changes nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'settle' })).toBe(INITIAL_NAV);
  });
});

describe('instance picks', () => {
  it('records the instance entered at each level, and drops it going up', () => {
    const s = navReduce(enter(INITIAL_NAV, 'die'), { type: 'enter', id: 'gpc-8tpc', instance: 3 });
    expect(s).toEqual({ path: ['die', 'gpc-8tpc'], picks: [0, 3], from: ['die'] });
    expect(back(s)).toEqual({ path: ['die'], picks: [0], from: ['die', 'gpc-8tpc'] });
  });

  it('keeps the picks of a prefix on goto, and fills 0 off the old path', () => {
    let s = navReduce(enter(INITIAL_NAV, 'die'), { type: 'enter', id: 'gpc-8tpc', instance: 3 });
    s = navReduce(s, { type: 'enter', id: 'sm', instance: 7 });
    expect(navReduce(s, { type: 'goto', path: ['die', 'gpc-8tpc'] }).picks).toEqual([0, 3]);
    expect(navReduce(s, { type: 'goto', path: ['die', 'gpc-9tpc'] }).picks).toEqual([0, 0]);
  });

  it('a different instance of the same node is a move, the same one is not', () => {
    const at = (n: number) => navReduce(enter(INITIAL_NAV, 'die'), { type: 'enter', id: 'g', instance: n });
    const s = at(1);
    expect(navReduce(s, { type: 'goto', path: ['die', 'g'] })).toBe(s);
    expect(at(1)).toEqual(s);
    expect(s.picks).not.toEqual(at(2).picks);
  });
});

describe('breadcrumbs', () => {
  it('has one crumb per level down to the current one, the last marked current', () => {
    expect(breadcrumbs([])).toEqual([{ label: 'Package', path: [], current: true }]);
    expect(breadcrumbs(['die', 'gpc'])).toEqual([
      { label: 'Package', path: [], current: false },
      { label: 'Die', path: ['die'], current: false },
      { label: 'GPC', path: ['die', 'gpc'], current: true },
    ]);
  });
});

describe('level notes', () => {
  it('only the SM and the sub-partition say what is physical and what is logical', () => {
    expect(levelNote(3)).toMatch(/warp/i);
    expect(levelNote(4)).toMatch(/logical/i);
    for (const d of [0, 1, 2]) expect(levelNote(d)).toBeNull();
  });
});
