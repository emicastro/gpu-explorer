import { expect, test } from '@playwright/test';

test('a screen under 1024 px shows the notice and the app still loads', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');
  await expect(page.getByTestId('small-screen-notice')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('a wide screen has no notice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('small-screen-notice')).toHaveCount(0);
});

test('the notice follows a resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId('small-screen-notice')).toBeVisible();
});

test('a core that fails to load shows an error instead of a black page', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('fatal-error')).toContainText('could not start');
  await expect(page.locator('canvas')).toHaveCount(0);
});
