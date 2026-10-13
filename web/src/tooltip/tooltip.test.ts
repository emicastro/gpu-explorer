import { describe, expect, it } from 'vitest';
import { tipReducer, type Tip, type TipEvent } from './stack.ts';

const run = (events: TipEvent[]): readonly Tip[] => events.reduce<readonly Tip[]>(tipReducer, []);
const ids = (items: readonly Tip[]) => items.map((t) => t.id);

describe('tooltip stack', () => {
  it('opens a tooltip nested inside another one level deeper', () => {
    const s = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'open', depth: 1, id: 'b' }]);
    expect(ids(s)).toEqual(['a', 'b']);
  });

  it('opening at a depth closes what was open from there up', () => {
    const s = run([
      { type: 'open', depth: 0, id: 'a' },
      { type: 'open', depth: 1, id: 'b' },
      { type: 'open', depth: 1, id: 'c' },
    ]);
    expect(ids(s)).toEqual(['a', 'c']);
    expect(ids(tipReducer(s, { type: 'open', depth: 0, id: 'd' }))).toEqual(['d']);
  });

  it('opening what is already open at that depth changes nothing, and keeps it pinned', () => {
    const pinned = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'pin', id: 'a' }]);
    expect(tipReducer(pinned, { type: 'open', depth: 0, id: 'a' })).toBe(pinned);
  });

  it('pins one tooltip, not its neighbours', () => {
    const s = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'open', depth: 1, id: 'b' }, { type: 'pin', id: 'a' }]);
    expect(s.map((t) => t.pinned)).toEqual([true, false]);
  });

  it('closing a tooltip closes the ones nested in it', () => {
    const s = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'open', depth: 1, id: 'b' }, { type: 'close', id: 'a' }]);
    expect(s).toEqual([]);
    expect(tipReducer(s, { type: 'close', id: 'zzz' })).toBe(s);
  });

  it('Escape closes the last one only', () => {
    const s = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'open', depth: 1, id: 'b' }, { type: 'pop' }]);
    expect(ids(s)).toEqual(['a']);
    expect(ids(tipReducer(s, { type: 'pop' }))).toEqual([]);
  });

  it('clear closes every tooltip, pinned or not', () => {
    const s = run([{ type: 'open', depth: 0, id: 'a' }, { type: 'pin', id: 'a' }, { type: 'clear' }]);
    expect(s).toEqual([]);
  });
});
