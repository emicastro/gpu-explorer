import { expect, test, type Page } from '@playwright/test';
import { waitForStore } from './helpers.ts';

/** Loads the app and collects console errors into the returned array. */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  return errors;
}

test('a kernel bar lights its roofline point', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  const first = await waitForStore(page, (s) => s.plan != null);
  const plan = first.plan;
  if (!plan) throw new Error('no plan');

  await page.getByTestId('kernel-bars').getByRole('button', { name: 'attention', exact: true }).first().click();
  const state = await waitForStore(page, (s) => s.sceneKernel?.op.kind === 'attention');
  expect(state.sceneKernel?.op.kind).toBe('attention');
  const attention = plan.kernels.find((k) => k.ops[0]?.kind === 'attention' && k.impl !== 'fa3_combine');
  await expect(page.getByTestId('roofline-selected')).toHaveAttribute('data-kernel', attention?.id ?? '');
  expect(errors).toEqual([]);
});

test('the context moves the HBM bar', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page);
  await waitForStore(page, (s) => s.plan != null);

  const bar = page.getByTestId('hbm-bar');
  const before = Number(await bar.getAttribute('data-kv-bytes'));
  const slider = page.getByRole('slider', { name: 'Context' });
  await slider.focus();
  await slider.press('End');
  await expect(bar).not.toHaveAttribute('data-kv-bytes', String(before));
  expect(Number(await bar.getAttribute('data-kv-bytes'))).toBeGreaterThan(before * 10);
  expect(errors).toEqual([]);
});
