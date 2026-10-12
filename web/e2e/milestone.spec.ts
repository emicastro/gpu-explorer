import { expect, test } from '@playwright/test';
import { getStoreState, waitForStore } from './helpers.ts';

test('the QKV GEMM flows over the die with the exact HBM bytes of the plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  // Let R3F mount and render before clicking: an earlier click reaches no mesh.
  await page.waitForTimeout(500);

  // The milestone's scenario is the default one: decode BF16, batch 1, 8k.
  const { scenario, plan } = await getStoreState(page);
  expect(scenario).toEqual({ batch: 1, context: 8192, weights: 'bf16', kv: 'bf16', phase: 'decode' });
  const qkv = plan?.kernels.find((k) => k.ops.some((o) => o.kind === 'qkv_proj' && o.layer === 0));
  if (!qkv) throw new Error('the plan has no QKV GEMM in layer 0');

  // No flow at the package level: the particles run over the die.
  const label = page.getByRole('complementary', { name: 'Data flow' });
  await expect(label).toHaveCount(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);

  await expect(label).toBeVisible();
  await expect(label).toContainText('HBM → L2 → SM → Tensor core');
  const text = await page.getByTestId('flow-bytes').textContent();
  expect(Number(text?.replace(/\D/g, ''))).toBe(qkv.bytes.hbmRead.value);
  await expect(label.getByLabel('documented').first()).toBeAttached();

  // Leaving the die takes the flow away.
  await page.keyboard.press('Escape');
  await waitForStore(page, (s) => s.path?.length === 0 && s.from === null);
  await expect(label).toHaveCount(0);

  expect(errors).toEqual([]);
});
