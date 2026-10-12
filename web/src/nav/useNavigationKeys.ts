import { useEffect } from 'react';
import { useStore } from '../state/store.ts';

/** Escape and Backspace go up one level (R7). Ignored while typing in a field. */
export function useNavigationKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Backspace') return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (useStore.getState().path.length === 0) return;
      e.preventDefault();
      useStore.getState().back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, []);
}
