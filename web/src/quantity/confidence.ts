import type { Confidence } from '../generated/Confidence.ts';

const ORDER: readonly Confidence[] = ['documented', 'simplified', 'estimated'];

/** The worst of several confidences; the core's rule, applied in the front to labels. */
export function worstConfidence(all: Iterable<Confidence>): Confidence {
  let worst = 0;
  for (const c of all) worst = Math.max(worst, ORDER.indexOf(c));
  return ORDER[worst] ?? 'documented';
}
