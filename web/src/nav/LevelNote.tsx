import { useStore } from '../state/store.ts';
import { levelNote } from './machine.ts';

/** Tells the physical apart from the logical at the levels where a warp could be mistaken for a block. */
export function LevelNote() {
  const depth = useStore((s) => s.path.length);
  const settled = useStore((s) => s.from === null);
  const note = settled ? levelNote(depth) : null;
  if (!note) return null;
  return (
    <aside className="level-note" aria-label="Physical and logical" data-testid="level-note">
      {note}
    </aside>
  );
}
