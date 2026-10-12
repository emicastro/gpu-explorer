import { expect, test, type Page } from '@playwright/test';
import type { StoreState } from '../src/state/types.ts';
import { getRenderInfo, getStoreState, waitForStore } from './helpers.ts';

test('enters the die by click and comes back with Escape, Backspace and the crumbs', async ({ page }) => {
  test.setTimeout(60_000);
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

/** Clicks at a fraction of the canvas, where the camera's resting pose puts the part to enter. */
async function clickAt(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test('goes down to a sub-partition by clicking, with the crumbs, labels and budget at each level', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  const crumbs = page.getByRole('navigation', { name: 'Hardware level' });
  const note = page.getByTestId('level-note');

  const settledAt = (depth: number) => (s: Partial<StoreState>) => s.path?.length === depth && s.from === null;
  const budget = async () => {
    const info = await getRenderInfo(page);
    expect(info.calls).toBeLessThanOrEqual(200);
    expect(info.triangles).toBeLessThanOrEqual(500_000);
  };

  await clickAt(page, 0.5, 0.5);
  await waitForStore(page, settledAt(1));
  await expect(note).toHaveCount(0);

  // GPC: the picks say which of the 8 was entered.
  await clickAt(page, 0.36, 0.74); // a GPC in the front row
  let state = await waitForStore(page, settledAt(2));
  expect(state.path?.[1]).toMatch(/^gpc-/);
  expect(state.picks).toHaveLength(2);
  await page.waitForTimeout(200);
  await expect(crumbs.getByRole('button')).toHaveText(['Package', 'Die', 'GPC']);
  await expect(page.getByTestId('label-tpc').filter({ visible: true })).toContainText('TPC');
  await expect(page.getByTestId('label-sm').filter({ visible: true })).toContainText('click to enter');
  await expect(note).toHaveCount(0);
  await budget();

  // SM
  await clickAt(page, 0.5, 0.4); // an enabled SM
  state = await waitForStore(page, settledAt(3));
  expect(state.path?.[2]).toMatch(/\/sm$/);
  await page.waitForTimeout(200);
  await expect(crumbs.getByRole('button')).toHaveText(['Package', 'Die', 'GPC', 'SM']);
  await expect(page.getByTestId('label-subpartition').filter({ visible: true })).toContainText('×4');
  await expect(note).toContainText('A warp is not here');
  await budget();

  // Sub-partition: the deepest level, with the tree's counts and the logical note.
  await clickAt(page, 0.31, 0.6); // a sub-partition
  await waitForStore(page, settledAt(4));
  await page.waitForTimeout(200);
  await expect(crumbs.getByRole('button')).toHaveText(['Package', 'Die', 'GPC', 'SM', 'Sub-partition']);
  await expect(page.getByTestId('label-fp32-core').filter({ visible: true })).toHaveText('FP32 cores ×32');
  await expect(note).toContainText('A warp is logical');
  await budget();

  // And back up with Escape, one level each, ending at the package.
  for (const depth of [3, 2, 1, 0]) {
    await page.keyboard.press('Escape');
    await waitForStore(page, settledAt(depth));
    state = await getStoreState(page);
    expect(state.picks).toHaveLength(depth);
  }
  await expect(crumbs.getByRole('button')).toHaveText(['Package']);
  expect(errors).toEqual([]);
});
