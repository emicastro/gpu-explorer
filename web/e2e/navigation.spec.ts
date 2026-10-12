import { expect, test } from '@playwright/test';
import { waitForStore } from './helpers.ts';

test('enters the die by click and comes back with Escape, Backspace and the crumbs', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  // Let R3F mount and render before clicking: an earlier click reaches no mesh.
  await page.waitForTimeout(500);
  const crumbs = page.getByRole('navigation', { name: 'Hardware level' });
  await expect(crumbs.getByRole('button')).toHaveText(['Package']);

  // The die sits at the center of the initial view.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const clickCenter = () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await clickCenter();
  let state = await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);
  expect(state.path).toEqual(['die']);
  await expect(crumbs.getByRole('button')).toHaveText(['Package', 'Die']);

  await page.keyboard.press('Escape');
  state = await waitForStore(page, (s) => s.path?.length === 0 && s.from === null);
  expect(state.path).toEqual([]);
  await expect(crumbs.getByRole('button')).toHaveText(['Package']);

  // Backspace works too, and the Package crumb jumps up from the die.
  await clickCenter();
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);
  await page.keyboard.press('Backspace');
  state = await waitForStore(page, (s) => s.path?.length === 0 && s.from === null);
  expect(state.path).toEqual([]);

  await clickCenter();
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);
  await crumbs.getByRole('button', { name: 'Package' }).click();
  state = await waitForStore(page, (s) => s.path?.length === 0 && s.from === null);
  expect(state.path).toEqual([]);
});
