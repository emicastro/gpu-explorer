// How a Quantity reads (design §6.9). Called only from `<Q>` and `<Num>`; the
// rest of the UI never formats a number itself (ADR 0022).
import { formatBytes, formatBytesShort } from '../flow/flow.ts';
import type { Quantity } from '../generated/Quantity.ts';

/** A value with an optional second reading: `50,339,840 B` and `(50.3 MB)`. */
export interface QuantityText {
  main: string;
  aside?: string;
}

const SI = ['', 'K', 'M', 'G', 'T', 'P'] as const;

/** `3.2e14` → `320.0 T`, for the units that run from FLOP to PFLOP. */
function withPrefix(value: number): string {
  let v = value;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < SI.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${SI[i] ?? ''}`;
}

/**
 * The text of a quantity. `compact` drops the second reading, for tight spots
 * (the HBM legend, the roofline readout): bytes come as `50.3 MB` only.
 */
export function quantityText(q: Quantity, compact = false): QuantityText {
  switch (q.unit) {
    case 'B':
      return compact
        ? { main: formatBytesShort(q.value) }
        : { main: formatBytes(q.value), aside: `(${formatBytesShort(q.value)})` };
    case 'B/s':
      return { main: `${formatBytesShort(q.value)}/s` };
    case 'Hz':
      return { main: `${(q.value / 1e9).toFixed(2)} GHz` };
    case 'FLOP':
    case 'FLOP/s':
      return { main: `${withPrefix(q.value)}${q.unit}` };
    case 'FLOP/B':
      return { main: `${q.value.toFixed(1)} FLOP/B` };
    case 'count':
      return { main: Math.round(q.value).toLocaleString('en-US') };
    case '1':
      return { main: String(q.value) };
    default:
      return { main: `${q.value.toLocaleString('en-US')} ${q.unit}` };
  }
}

/** The whole text on one line, for tests and plain-text uses inside `<Q>`. */
export function formatQuantity(q: Quantity, compact = false): string {
  const { main, aside } = quantityText(q, compact);
  return aside ? `${main} ${aside}` : main;
}
