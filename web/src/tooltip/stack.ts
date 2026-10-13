// The stack of open tooltips (design §7, R15). Pure: timers live in `useTip`.
// A tooltip opens at a depth: 0 from the page or the 3D, one more for each
// tooltip it sits inside. Opening at a depth closes what was open from there up.
import { create } from 'zustand';

/** Hover this long on a trigger to open its tooltip; focus opens it at once. */
export const HOVER_MS = 600;
/** An open tooltip pins itself after this long. */
export const PIN_MS = 1500;
/** Leaving a trigger or its tooltip closes an unpinned one after this, so crossing the gap doesn't. */
export const GRACE_MS = 250;

export interface Tip {
  id: string;
  pinned: boolean;
}

export type TipEvent =
  | { type: 'open'; depth: number; id: string }
  | { type: 'pin'; id: string }
  | { type: 'close'; id: string }
  /** Escape: closes the last one. */
  | { type: 'pop' }
  | { type: 'clear' };

export function tipReducer(items: readonly Tip[], e: TipEvent): readonly Tip[] {
  switch (e.type) {
    case 'open':
      if (items[e.depth]?.id === e.id) return items;
      return [...items.slice(0, e.depth), { id: e.id, pinned: false }];
    case 'pin':
      return items.map((t) => (t.id === e.id ? { ...t, pinned: true } : t));
    case 'close': {
      const i = items.findIndex((t) => t.id === e.id);
      return i < 0 ? items : items.slice(0, i);
    }
    case 'pop':
      return items.slice(0, -1);
    case 'clear':
      return items.length === 0 ? items : [];
  }
}

interface TipStore {
  items: readonly Tip[];
  dispatch: (e: TipEvent) => void;
}

export const useTips = create<TipStore>((set) => ({
  items: [],
  dispatch: (e) => { set((s) => ({ items: tipReducer(s.items, e) })); },
}));
