import { expect, test } from '@playwright/test';
import { getStoreState, waitForStore } from './helpers.ts';

test('moving the context knob re-evaluates the plan and flags YaRN past 32k', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  const first = await waitForStore(page, (s) => s.plan != null);
  const kvBefore = first.plan?.memory.kv.value;
  if (kvBefore === undefined) throw new Error('no plan');
  await expect(page.getByTestId('yarn-note')).toHaveCount(0);

  // End moves a range input to its maximum: 131072 tokens.
  const slider = page.getByRole('slider', { name: 'Context' });
  await slider.focus();
  await slider.press('End');
  const state = await waitForStore(page, (s) => s.scenario?.context === 131072);
  expect(state.scenario?.context).toBe(131072);
  const kvAfter = (await getStoreState(page)).plan?.memory.kv.value;
  if (kvAfter === undefined) throw new Error('no plan after the change');
  // The KV cache grows with the context: 131072 / 8192 = 16x (a decode token or so aside).
  expect(kvAfter / kvBefore).toBeGreaterThan(15);
  expect(kvAfter / kvBefore).toBeLessThan(17);
  await expect(page.getByTestId('yarn-note')).toBeVisible();

  await page.getByRole('combobox', { name: 'KV cache' }).selectOption('fp8');
  const fp8 = await waitForStore(page, (s) => s.scenario?.kv === 'fp8');
  expect(fp8.plan?.memory.kv.value).toBeCloseTo(kvAfter / 2, -3);
  expect(errors).toEqual([]);
});
