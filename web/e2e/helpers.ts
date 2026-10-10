import type { Page } from '@playwright/test';
import type { StoreState } from '../src/state/types.ts';

// This project has no DOM lib (tsconfig.node.json), so `window` is reached through globalThis.
type Hooked = { __gpuviz?: { getState: () => unknown; setState: (p: unknown) => void } };

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

/** Polls until `pick(state)` is true, then returns the state (last state on timeout). */
export async function waitForStore(
  page: Page,
  pick: (s: Partial<StoreState>) => boolean,
): Promise<Partial<StoreState>> {
  let state = await getStoreState(page);
  for (let i = 0; i < 50 && !pick(state); i++) {
    await page.waitForTimeout(100);
    state = await getStoreState(page);
  }
  return state;
}
