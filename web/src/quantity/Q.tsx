import { useId, useReducer, type KeyboardEvent } from 'react';
import type { Quantity } from '../generated/Quantity.ts';
import { Dot } from './Dot.tsx';
import { quantityText } from './format.ts';
import { isOpen, POPOVER_CLOSED, popoverReducer } from './popover.ts';

interface QProps {
  value: Quantity;
  /** Drop the second reading of bytes, for tight spots. */
  compact?: boolean;
  /** Goes on the element that holds the main text, for tests. */
  testId?: string;
  /** Start with the popover open (tests render it without a DOM). */
  open?: boolean;
}

/** What the popover says: the confidence and where the number comes from. */
export function QSources({ value }: { value: Quantity }) {
  return (
    <>
      <strong>{value.confidence}</strong>
      {value.sources.length > 0 ? (
        <ul>
          {value.sources.map((s) => <li key={s}>{s}</li>)}
        </ul>
      ) : (
        <span> · no sources listed</span>
      )}
    </>
  );
}

/**
 * The one component that shows a quantity (design §6.9, R16): the number with
 * its unit, a confidence dot, and on hover or focus its sources. Escape or
 * leaving closes the popover; while it is open Escape does not also go up a
 * level of the machine.
 */
export function Q({ value, compact, testId, open: initiallyOpen }: QProps) {
  const [state, dispatch] = useReducer(popoverReducer, initiallyOpen ? { ...POPOVER_CLOSED, focus: true } : POPOVER_CLOSED);
  const id = useId();
  const open = isOpen(state);
  const { main, aside } = quantityText(value, compact);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    dispatch('escape');
  };
  return (
    <span
      className="q"
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => { dispatch('enter'); }}
      onMouseLeave={() => { dispatch('leave'); }}
      onFocus={() => { dispatch('focus'); }}
      onBlur={() => { dispatch('blur'); }}
      onKeyDown={onKeyDown}
    >
      <span className="q-main" data-testid={testId}>{main}</span>
      {aside && <span className="q-aside"> {aside}</span>}
      <Dot confidence={value.confidence} />
      {open && (
        <span className="q-popover" role="tooltip" id={id}>
          <QSources value={value} />
        </span>
      )}
    </span>
  );
}
