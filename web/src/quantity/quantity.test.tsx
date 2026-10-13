import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Confidence } from '../generated/Confidence.ts';
import type { Quantity } from '../generated/Quantity.ts';
import { worstConfidence } from './confidence.ts';
import { formatQuantity } from './format.ts';
import { Num } from './Num.tsx';
import { isOpen, POPOVER_CLOSED, popoverReducer, type PopoverEvent, type PopoverState } from './popover.ts';
import { Q } from './Q.tsx';

const q = (over: Partial<Quantity> = {}): Quantity => ({
  value: 50339840,
  unit: 'B',
  confidence: 'documented',
  sources: ['NVIDIA H100 whitepaper, p. 12'],
  ...over,
});

describe('quantity text', () => {
  it('formats quantities for reading', () => {
    expect(formatQuantity(q())).toBe('50,339,840 B (50.3 MB)');
    expect(formatQuantity(q(), true)).toBe('50.3 MB');
    expect(formatQuantity(q({ value: 1.83e9, unit: 'Hz' }))).toBe('1.83 GHz');
    expect(formatQuantity(q({ value: 65536, unit: 'count' }))).toBe('65,536');
    expect(formatQuantity(q({ value: 3.2e14, unit: 'FLOP/s' }))).toBe('320.0 TFLOP/s');
  });
});

describe('quantity indicator', () => {
  it.each<Confidence>(['documented', 'simplified', 'estimated'])('<Q> shows the %s level', (confidence) => {
    const html = renderToStaticMarkup(<Q value={q({ confidence })} />);
    expect(html).toContain(`confidence-${confidence}`);
    expect(html).toContain(`aria-label="${confidence}"`);
    expect(html).toContain('50,339,840 B');
    // Closed until hovered or focused.
    expect(html).not.toContain('role="tooltip"');
  });

  it('lists the sources in the open popover, or says there are none', () => {
    const open = renderToStaticMarkup(<Q value={q({ confidence: 'simplified' })} open />);
    expect(open).toContain('role="tooltip"');
    expect(open).toContain('simplified');
    expect(open).toContain('NVIDIA H100 whitepaper, p. 12');
    expect(renderToStaticMarkup(<Q value={q({ sources: [] })} open />)).toContain('no sources listed');
  });

  it('<Num> shows the bare number and no confidence', () => {
    expect(renderToStaticMarkup(<Num value={4} />)).toBe('4');
    expect(renderToStaticMarkup(<Num value={1.25} format={(n) => `${n.toFixed(1)} s`} />)).toBe('1.3 s');
  });

  it('the worst confidence wins', () => {
    expect(worstConfidence(['documented', 'estimated', 'simplified'])).toBe('estimated');
    expect(worstConfidence([])).toBe('documented');
  });
});

describe('quantity popover', () => {
  const run = (events: PopoverEvent[]): PopoverState => events.reduce(popoverReducer, POPOVER_CLOSED);

  it('opens with focus or hover', () => {
    expect(isOpen(run(['focus']))).toBe(true);
    expect(isOpen(run(['enter']))).toBe(true);
    expect(isOpen(POPOVER_CLOSED)).toBe(false);
  });

  it('closes with Escape, and stays closed until pointer and focus are gone', () => {
    const closed = run(['focus', 'escape']);
    expect(isOpen(closed)).toBe(false);
    expect(isOpen(popoverReducer(closed, 'enter'))).toBe(false);
    expect(isOpen(run(['focus', 'escape', 'blur', 'focus']))).toBe(true);
  });

  it('closes on blur and on leave, but only when neither is left', () => {
    expect(isOpen(run(['focus', 'blur']))).toBe(false);
    expect(isOpen(run(['enter', 'focus', 'leave']))).toBe(true);
    expect(isOpen(run(['enter', 'leave']))).toBe(false);
  });
});
