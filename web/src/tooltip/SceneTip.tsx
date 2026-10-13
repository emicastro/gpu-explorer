// The tooltip of a part in the 3D (R15): hover on an enterable part for a
// moment and its component's name and short description appear at the pointer,
// as a box of the same stack as the glossary's. Moving into the box pins it,
// so the terms inside can be hovered.
import { useEffect, useId, useState } from 'react';
import { create } from 'zustand';
import type { HwNode } from '../core/index.ts';
import { InlineText } from '../content/Prose.tsx';
import { proseFor } from '../panel/facts.ts';
import { findPart } from '../scene/parts.ts';
import { useStore } from '../state/store.ts';
import { TipBox } from './Tip.tsx';
import { GRACE_MS, HOVER_MS, useTips } from './stack.ts';

interface Hover {
  nodeId: string;
  /** Client coordinates of the pointer. */
  x: number;
  y: number;
}

/** What the pointer is over in the 3D; null when it is over nothing with a tooltip. */
export const useSceneHover = create<{ hover: Hover | null; set: (h: Hover | null) => void }>((set) => ({
  hover: null,
  set: (hover) => { set({ hover }); },
}));

export function SceneTip({ hardware }: { hardware: HwNode }) {
  const id = useId();
  const hover = useSceneHover((s) => s.hover);
  const tip = useTips((s) => s.items.find((t) => t.id === id));
  /** The part and place the open box was opened for. */
  const [shown, setShown] = useState<Hover | null>(null);
  const nodeId = hover?.nodeId;

  // A different part under the pointer starts the wait again; leaving them all closes an unpinned box after the grace.
  useEffect(() => {
    const { dispatch, items } = useTips.getState();
    if (!hover) {
      const t = window.setTimeout(() => {
        if (useTips.getState().items.some((i) => i.id === id && !i.pinned)) useTips.getState().dispatch({ type: 'close', id });
      }, GRACE_MS);
      return () => { window.clearTimeout(t); };
    }
    if (items.some((i) => i.id === id && i.pinned)) return;
    const t = window.setTimeout(() => {
      dispatch({ type: 'close', id });
      dispatch({ type: 'open', depth: 0, id });
      setShown(hover);
    }, HOVER_MS);
    return () => { window.clearTimeout(t); };
    // The place only moves the box when a new wait starts: a different part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, id]);

  // Entering or leaving a level closes the box: what it named is no longer under the pointer.
  const depth = useStore((st) => st.path.length);
  useEffect(() => {
    useSceneHover.getState().set(null);
    useTips.getState().dispatch({ type: 'close', id });
  }, [depth, id]);

  if (!tip || !shown) return null;
  const node = findPart(hardware, shown.nodeId);
  const prose = proseFor(node);
  return (
    <span
      className="tip-wrap"
      data-tip-id={id}
      onPointerEnter={() => { useTips.getState().dispatch({ type: 'pin', id }); }}
    >
      <TipBox tip={{ id, anchor: { x: shown.x + 12, y: shown.y + 8 } }} className="scene-tip">
        <span className="scene-tip-name">{node.name}</span>
        {prose && <span className="tip-short"><InlineText nodes={prose.does} /></span>}
      </TipBox>
    </span>
  );
}
