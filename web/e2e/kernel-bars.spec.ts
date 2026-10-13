import { expect, test } from '@playwright/test';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

test('clicking a kernel bar moves the playhead and the scene to that kernel', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await setStoreState(page, { path: ['die'], picks: [0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);

  const bars = page.getByTestId('kernel-bars');
  const attention = bars.getByRole('button', { name: 'attention', exact: true }).first();
  await attention.click();
  const state = await waitForStore(page, (s) => s.sceneKernel?.op.kind === 'attention');
  expect(state.sceneKernel?.op.kind).toBe('attention');
  await expect(attention).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('transport-now')).toContainText('attention');
  expect((await getStoreState(page)).playhead).toBeGreaterThan(0);

  // A folded layer is one bar; clicking it opens the layer.
  await bars.getByRole('button', { name: 'layer 5' }).click();
  const opened = await waitForStore(page, (s) => s.focusLayer === 5);
  expect(opened.focusLayer).toBe(5);
  expect(errors).toEqual([]);
});
