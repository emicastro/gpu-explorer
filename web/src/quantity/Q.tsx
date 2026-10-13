import type { Quantity } from '../generated/Quantity.ts';
import { TipBox, useTip } from '../tooltip/Tip.tsx';
import { Dot } from './Dot.tsx';
import { quantityText } from './format.ts';

interface QProps {
  value: Quantity;
  /** Drop the second reading of bytes, for tight spots. */
  compact?: boolean;
  /** Goes on the element that holds the main text, for tests. */
  testId?: string;
  /** Render the popover open (tests render it without a DOM). */
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
 * its unit, a confidence dot, and on hover or focus its sources in a tooltip
 * of the shared stack (R15, task 8.2). Escape closes it before the level goes up.
 */
export function Q({ value, compact, testId, open: forcedOpen }: QProps) {
  const tip = useTip(forcedOpen);
  const { main, aside } = quantityText(value, compact);
  return (
    <span className="q" tabIndex={0} data-tip-trigger aria-describedby={tip.open ? `tip-${tip.id}` : undefined} {...tip.props}>
      <span className="q-main" data-testid={testId}>{main}</span>
      {aside && <span className="q-aside"> {aside}</span>}
      <Dot confidence={value.confidence} />
      {tip.open && (
        <TipBox tip={tip}>
          <QSources value={value} />
        </TipBox>
      )}
    </span>
  );
}
