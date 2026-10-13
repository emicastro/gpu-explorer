import type { Confidence } from '../generated/Confidence.ts';

/**
 * The confidence mark of a number (R16): the same dot beside a `<Q>` and on a
 * 3D label. It takes no pointer events of its own.
 */
export function Dot({ confidence }: { confidence: Confidence }) {
  return <span className={`confidence confidence-${confidence}`} role="img" aria-label={confidence} />;
}
