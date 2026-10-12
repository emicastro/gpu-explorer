// One palette for the whole scene, by function (brief D13). Colors are chosen
// here and nowhere else.

/** What a part of the chip does; the color follows it. */
export type PartKind =
  | 'interposer'
  | 'die'
  | 'hbm'
  | 'gpc'
  | 'l2'
  | 'memory-controller'
  | 'gigathread';

export const PART_COLORS: Record<PartKind, string> = {
  interposer: '#3a4256',
  die: '#5a6478',
  hbm: '#e0a03c',
  gpc: '#4c8bf5',
  l2: '#9b6bdf',
  'memory-controller': '#3fb58a',
  gigathread: '#e0607a',
};

const BACKGROUND = [0x0b, 0x0d, 0x12] as const;
/** How much of a disabled part's color survives (the rest is background). */
const DISABLED_KEEP = 0.3;

/** Mixes `hex` toward the background; used for disabled parts. */
function dim(hex: string): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mixed = channels.map((c, i) => Math.round((c * DISABLED_KEEP) + (BACKGROUND[i] ?? 0) * (1 - DISABLED_KEEP)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The color of a part; disabled parts are dimmed, not hidden (R8). */
export function partColor(kind: PartKind, enabled: boolean): string {
  return enabled ? PART_COLORS[kind] : dim(PART_COLORS[kind]);
}
