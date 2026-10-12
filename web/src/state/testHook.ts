import { readRenderInfo, type RenderInfo } from '../scene/renderInfo.ts';
import { useStore } from './store.ts';
import type { StoreState } from './types.ts';

/** What e2e tests see as `window.__gpuviz`. */
export interface GpuvizHook {
  /** A plain-data copy of the store (functions dropped, so it crosses the Playwright boundary). */
  getState: () => Partial<StoreState>;
  setState: (patch: Partial<StoreState>) => void;
  /** Draw calls, triangles and pixel ratio of the last frame; null before the canvas mounts. */
  renderInfo: () => RenderInfo | null;
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
    renderInfo: readRenderInfo,
  };
}
