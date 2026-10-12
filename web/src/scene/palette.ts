// One palette for the whole scene, by function (brief D13). Colors are chosen
// here and nowhere else.

/** What a part of the chip does; the color follows it. */
export const PART_KINDS = [
  'substrate',
  'stiffener',
  'interposer',
  'bumps',
  'die',
  'hbm',
  'gpc',
  'sm',
  'l2',
  'memory-controller',
  'gigathread',
] as const;

export type PartKind = (typeof PART_KINDS)[number];

export const PART_COLORS: Record<PartKind, string> = {
  substrate: '#1d2a26',
  stiffener: '#b9bec7',
  interposer: '#3a4256',
  bumps: '#c9a24e',
  die: '#5a6478',
  hbm: '#e0a03c',
  gpc: '#2c4f8f',
  sm: '#4c8bf5',
  l2: '#9b6bdf',
  'memory-controller': '#3fb58a',
  gigathread: '#e0607a',
};

/** What a byte in the flow is; particles take this color (task 4.4). */
export type TrafficClass = 'weights' | 'kv' | 'activations';

export const FLOW_COLORS: Record<TrafficClass, string> = {
  weights: '#ffd27a',
  kv: '#ff8a5c',
  activations: '#7fe3ff',
};

/** The drawn legs of the flow (ADR 0018). */
export const FLOW_PATH_COLOR = '#8fb8ff';

export const SCENE_BACKGROUND = '#0b0d12';

/** The studio the environment map is rendered from (ADR 0017), and the key light. */
export const LIGHT_COLORS = {
  softbox: '#ffffff',
  cool: '#9cc2ff',
  warm: '#ffd9a8',
  key: '#fff4e6',
} as const;

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BACKGROUND = channels(SCENE_BACKGROUND);
/** How much of a disabled part's color survives (the rest is background). */
const DISABLED_KEEP = 0.3;

/** Mixes `hex` toward the background; used for disabled parts. */
function dim(hex: string): string {
  const mixed = channels(hex).map((c, i) => Math.round((c * DISABLED_KEEP) + (BACKGROUND[i] ?? 0) * (1 - DISABLED_KEEP)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The color of a part; disabled parts are dimmed, not hidden (R8). */
export function partColor(kind: PartKind, enabled: boolean): string {
  return enabled ? PART_COLORS[kind] : dim(PART_COLORS[kind]);
}
