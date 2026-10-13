// When the sources popover of a `<Q>` is open (R16, ADR 0022 option 3A). A
// minimal stand-in for the tooltip stack of task 8.2, which replaces it without
// changing `<Q>`'s props. Pure, so it can be tested without a DOM.

/** Where the pointer and the focus are, and whether Escape closed it. */
export interface PopoverState {
  hover: boolean;
  focus: boolean;
  /** Escape closes it until the pointer and the focus have both left. */
  dismissed: boolean;
}

export type PopoverEvent = 'enter' | 'leave' | 'focus' | 'blur' | 'escape';

export const POPOVER_CLOSED: PopoverState = { hover: false, focus: false, dismissed: false };

export function popoverReducer(s: PopoverState, event: PopoverEvent): PopoverState {
  const next = { ...s };
  switch (event) {
    case 'enter':
      next.hover = true;
      break;
    case 'leave':
      next.hover = false;
      break;
    case 'focus':
      next.focus = true;
      break;
    case 'blur':
      next.focus = false;
      break;
    case 'escape':
      next.dismissed = true;
      break;
  }
  if (!next.hover && !next.focus) next.dismissed = false;
  return next;
}

export const isOpen = (s: PopoverState): boolean => (s.hover || s.focus) && !s.dismissed;
