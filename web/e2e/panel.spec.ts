import { expect, test } from '@playwright/test';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

const G = 'gpc-8tpc';

test('the panel of an SM shows its specs and the plan\'s numbers for the kernel on the scene', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  // Jump to an SM, as the store would after three clicks (navigation.spec covers the clicks).
  await setStoreState(page, { path: ['die', G, `${G}/tpc/sm`], picks: [0, 0, 0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 3 && s.from === null);

  const panel = page.getByTestId('component-panel');
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'About this sm' }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: /^SM/ })).toBeVisible();
  await expect(panel).toContainText('Max warps');
  await expect(panel).toContainText('64');

  // "What the LLM does here" carries the plan's block count for the QKV GEMM.
  const { plan } = await getStoreState(page);
  const qkv = plan?.kernels.find((k) => k.layer === 0 && k.ops.some((o) => o.kind === 'qkv_proj'));
  if (!qkv) throw new Error('the plan has no QKV GEMM');
  const blocks = await panel.locator('dt', { hasText: 'Blocks (CTAs)' }).locator('xpath=following-sibling::dd[1]').textContent();
  expect(Number((blocks ?? '').replace(/[^\d]/g, ''))).toBe(qkv.grid.blocks.value);

  // The parts inside open in turn.
  await panel.getByRole('button', { name: /^SM sub-partition/ }).click();
  await expect(panel.getByRole('heading', { name: /^SM sub-partition/ })).toBeVisible();
  await panel.getByRole('button', { name: /^Tensor core/ }).click();
  await expect(panel).toContainText('yes, BF16');

  await panel.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveCount(0);

  // Going up closes the panel of the level you left.
  await page.getByRole('button', { name: 'About this sm' }).click();
  await page.keyboard.press('Escape');
  await waitForStore(page, (s) => s.path?.length === 2 && s.from === null);
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
