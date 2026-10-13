// The tooltip primitive: a trigger that opens a box, used by glossary terms,
// `<Q>` sources and the 3D hover (R15, R16). A box sits inside its trigger's
// element in the DOM, so Tab goes into it and hover inside it counts as hover
// on the trigger; nested boxes nest the same way.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { GRACE_MS, HOVER_MS, PIN_MS, useTips } from './stack.ts';

const DepthContext = createContext(0);

/** Set while Escape hands the focus back to a trigger, so that the focus doesn't reopen what was just closed. */
const restoring = { on: false };

export interface Anchor {
  x: number;
  y: number;
}

/** Everything a trigger needs to spread on its element. */
export interface TipTrigger {
  id: string;
  open: boolean;
  pinned: boolean;
  anchor: Anchor;
  /** Spread on the element that holds the trigger and the box. */
  props: {
    ref: (el: HTMLElement | null) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: (e: FocusEvent) => void;
    onBlur: (e: FocusEvent) => void;
    onClick: (e: MouseEvent<HTMLElement>) => void;
    'data-tip-id': string;
  };
}

export function useTip(forcedOpen = false): TipTrigger {
  const id = useId();
  const depth = useContext(DepthContext);
  const dispatch = useTips((s) => s.dispatch);
  const tip = useTips((s) => s.items.find((t) => t.id === id));
  const open = forcedOpen || tip !== undefined;
  const pinned = tip?.pinned ?? false;
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0 });
  const el = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number>(0);
  const pinTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);

  const clearAll = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(pinTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  // Closed from elsewhere (Escape, a sibling opening, a click outside): no timer should fire for it.
  useEffect(() => {
    if (!open) clearAll();
  }, [open, clearAll]);
  useEffect(() => clearAll, [clearAll]);

  const show = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    if (useTips.getState().items.some((t) => t.id === id)) return;
    const r = el.current?.getBoundingClientRect();
    setAnchor({ x: r?.left ?? 0, y: r?.bottom ?? 0 });
    dispatch({ type: 'open', depth, id });
    pinTimer.current = window.setTimeout(() => { dispatch({ type: 'pin', id }); }, PIN_MS);
  }, [depth, dispatch, id]);

  const scheduleClose = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      const mine = useTips.getState().items.find((t) => t.id === id);
      if (mine && !mine.pinned) dispatch({ type: 'close', id });
    }, GRACE_MS);
  }, [dispatch, id]);

  return {
    id,
    open,
    pinned,
    anchor,
    props: {
      ref: (node) => { el.current = node; },
      onPointerEnter: () => {
        window.clearTimeout(closeTimer.current);
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(show, HOVER_MS);
      },
      onPointerLeave: scheduleClose,
      onFocus: () => {
        if (!restoring.on) show();
      },
      onBlur: (e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        scheduleClose();
      },
      onClick: (e) => {
        // A click inside this wrapper's own box is not on the trigger; a nested trigger's click is its own.
        const box = e.target instanceof Element ? e.target.closest('.tip-box') : null;
        if (box && e.currentTarget.contains(box)) return;
        window.clearTimeout(pinTimer.current);
        if (pinned) dispatch({ type: 'close', id });
        else {
          show();
          dispatch({ type: 'pin', id });
        }
      },
      'data-tip-id': id,
    },
  };
}

/** The box. Fixed to the viewport at `anchor`, so no scrolling ancestor clips it. */
export function TipBox({ tip, children, className }: { tip: Pick<TipTrigger, 'id' | 'anchor'>; children: ReactNode; className?: string }) {
  const depth = useContext(DepthContext);
  // Clamped in CSS so the box stays on screen (and renders without a window).
  const left = `max(8px, min(${String(tip.anchor.x)}px, calc(100vw - 360px)))`;
  return (
    <DepthContext.Provider value={depth + 1}>
      <span
        className={className ? `tip-box ${className}` : 'tip-box'}
        role="tooltip"
        id={`tip-${tip.id}`}
        style={{ left, top: tip.anchor.y + 4 }}
      >
        {children}
      </span>
    </DepthContext.Provider>
  );
}

/** Escape closes the last tooltip, and a press outside every tooltip closes them all. Mount once. */
export function useTipKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { items, dispatch } = useTips.getState();
      const last = items[items.length - 1];
      if (!last) return;
      // Before anything else, so the level doesn't also go up (R7).
      e.stopPropagation();
      e.preventDefault();
      const wrap = document.querySelector<HTMLElement>(`[data-tip-id="${CSS.escape(last.id)}"]`);
      const focusWrap = wrap?.contains(document.activeElement) ? wrap : null;
      dispatch({ type: 'pop' });
      if (focusWrap) {
        const trigger = focusWrap.matches('[data-tip-trigger]') ? focusWrap : focusWrap.querySelector<HTMLElement>(':scope > [data-tip-trigger]');
        restoring.on = true;
        trigger?.focus();
        restoring.on = false;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-tip-id], .tip-box')) return;
      useTips.getState().dispatch({ type: 'clear' });
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
}
