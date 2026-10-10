import { expect, test } from '@playwright/test';
import { getStoreState, setStoreState } from './helpers.ts';

test('page loads with a WebGL canvas and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  // Let R3F mount and render a few frames before checking for errors.
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
});

test('window.__gpuviz exposes the store state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  const state = await getStoreState(page);
  expect(state.scenario).toMatchObject({ batch: 1, phase: 'decode' });
  expect(state.path).toEqual([]);

  await setStoreState(page, { playhead: 1.5 });
  expect((await getStoreState(page)).playhead).toBe(1.5);
});
