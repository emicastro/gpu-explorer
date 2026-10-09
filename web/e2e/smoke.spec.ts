import { expect, test } from '@playwright/test';

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
