import { useStore } from './store.ts';
import type { StoreState } from './types.ts';

/** What e2e tests see as `window.__gpuviz`. */
export interface GpuvizHook {
  /** A plain-data copy of the store (functions dropped, so it crosses the Playwright boundary). */
  getState: () => Partial<StoreState>;
  setState: (patch: Partial<StoreState>) => void;
}

declare global {
  interface Window {
    __gpuviz?: GpuvizHook;
  }
}

/** Installs `window.__gpuviz`. Only called from a test build (see main.tsx). */
export function installTestHook(): void {
  window.__gpuviz = {
    getState: () =>
      Object.fromEntries(
        Object.entries(useStore.getState()).filter(([, v]) => typeof v !== 'function'),
      ),
    setState: (patch) => { useStore.setState(patch); },
  };
}
