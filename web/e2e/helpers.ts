import type { Page } from '@playwright/test';
import type { RenderInfo } from '../src/scene/renderInfo.ts';
import type { StoreState } from '../src/state/types.ts';

// This project has no DOM lib (tsconfig.node.json), so `window` is reached through globalThis.
type Hooked = {
  __gpuviz?: { getState: () => unknown; setState: (p: unknown) => void; renderInfo: () => unknown };
};

/** Reads the store through `window.__gpuviz` (present only in `--mode test` builds). */
export async function getStoreState(page: Page): Promise<Partial<StoreState>> {
  return page.evaluate(() => {
    const hook = (globalThis as unknown as Hooked).__gpuviz;
    if (!hook) throw new Error('window.__gpuviz is missing: not a test build');
    return hook.getState() as Partial<StoreState>;
  });
}

/** Merges `patch` into the store through `window.__gpuviz`. */
export async function setStoreState(page: Page, patch: Partial<StoreState>): Promise<void> {
  await page.evaluate((p) => {
    const hook = (globalThis as unknown as Hooked).__gpuviz;
    if (!hook) throw new Error('window.__gpuviz is missing: not a test build');
    hook.setState(p);
  }, patch);
}

/** Polls (up to 15 s, for a loaded machine) until `pick(state)` is true, then returns the state (last state on timeout). */
export async function waitForStore(
  page: Page,
  pick: (s: Partial<StoreState>) => boolean,
): Promise<Partial<StoreState>> {
  let state = await getStoreState(page);
  for (let i = 0; i < 150 && !pick(state); i++) {
    await page.waitForTimeout(100);
    state = await getStoreState(page);
  }
  return state;
}

/** The last frame's draw calls and triangles, through `window.__gpuviz.renderInfo()`. */
export async function getRenderInfo(page: Page): Promise<RenderInfo> {
  const info = await page.evaluate(() => {
    const hook = (globalThis as unknown as Hooked).__gpuviz;
    if (!hook) throw new Error('window.__gpuviz is missing: not a test build');
    return hook.renderInfo() as RenderInfo | null;
  });
  if (!info) throw new Error('the canvas has not rendered yet');
  return info;
}
