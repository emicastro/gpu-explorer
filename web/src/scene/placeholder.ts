// Stand-in geometry until the package and die layouts exist (task 4.3).
// `id` is the hardware-tree node a click enters; null means not enterable.
export interface PlaceholderBox {
  key: string;
  id: string | null;
  position: readonly [number, number, number];
  size: readonly [number, number, number];
  color: string;
  /** Siblings fade out when the user enters a child. */
  sibling: boolean;
}

export const PLACEHOLDER_BOXES: readonly PlaceholderBox[] = [
  { key: 'interposer', id: null, position: [0, -0.1, 0], size: [3, 0.1, 2], color: '#3a4256', sibling: true },
  { key: 'die', id: 'die', position: [0, 0.1, 0], size: [1.2, 0.3, 1.2], color: '#4c8bf5', sibling: false },
  { key: 'hbm-left', id: null, position: [-1.1, 0.05, 0], size: [0.4, 0.2, 1.4], color: '#e0a03c', sibling: true },
  { key: 'hbm-right', id: null, position: [1.1, 0.05, 0], size: [0.4, 0.2, 1.4], color: '#e0a03c', sibling: true },
];
