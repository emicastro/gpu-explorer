import { describe, expect, it } from 'vitest';
import { breadcrumbs, INITIAL_NAV, MAX_DEPTH, navReduce, type NavState } from './machine.ts';

const enter = (s: NavState, id: string) => navReduce(s, { type: 'enter', id });
const back = (s: NavState) => navReduce(s, { type: 'back' });

describe('navigation state machine', () => {
  it('starts at the package, settled', () => {
    expect(INITIAL_NAV).toEqual({ path: [], from: null });
  });

  it('enter goes one level down and records where it came from', () => {
    const s = enter(INITIAL_NAV, 'die');
    expect(s).toEqual({ path: ['die'], from: [] });
    expect(navReduce(s, { type: 'settle' })).toEqual({ path: ['die'], from: null });
  });

  it('back goes up one level and is a no-op at the package', () => {
    const settled = navReduce(enter(INITIAL_NAV, 'die'), { type: 'settle' });
    expect(back(settled)).toEqual({ path: [], from: ['die'] });
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
    expect(back(flying)).toEqual({ path: [], from: ['die'] });
  });

  it('goto jumps to a prefix (a crumb click) and ignores the current path', () => {
    const deep = enter(enter(INITIAL_NAV, 'die'), 'gpc');
    expect(navReduce(deep, { type: 'goto', path: [] })).toEqual({ path: [], from: ['die', 'gpc'] });
    expect(navReduce(deep, { type: 'goto', path: ['die', 'gpc'] })).toBe(deep);
  });

  it('settle on a settled state changes nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'settle' })).toBe(INITIAL_NAV);
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
