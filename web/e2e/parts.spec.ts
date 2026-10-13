import { expect, test, type Page } from '@playwright/test';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

const G = 'gpc-8tpc';
const SUB = [`die`, G, `${G}/tpc/sm`, `${G}/tpc/sm/subpartition`];

async function open(page: Page, path: string[] = []) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  if (path.length > 0) {
    await setStoreState(page, { path, picks: path.map(() => 0), from: [] });
    await waitForStore(page, (s) => s.path?.length === path.length && s.from === null);
    await page.waitForTimeout(1500);
  }
}

/** Hovers a point of the canvas and expects the tooltip to name the part and define it. */
async function expectTip(page: Page, x: number, y: number, name: string, definition: RegExp) {
  await page.mouse.move(1, 1);
  await page.mouse.move(x, y);
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveCount(1);
  await expect(tip).toContainText(name);
  await expect(tip).toContainText(definition);
}

test('parts: hover names and defines parts of the package that have no level', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await expectTip(page, 520, 300, 'HBM3 stack site', /High Bandwidth Memory/);
  await expectTip(page, 480, 378, 'Silicon interposer', /thin slice of silicon/);
  await expectTip(page, 600, 610, 'Stiffener ring', /keeps the package flat/);
  expect((await getStoreState(page)).path).toEqual([]);
});

test('parts: hover names and defines the L2 and a tensor core, and a click on L2 opens its panel without changing the path', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, ['die']);
  await expectTip(page, 500, 365, 'L2', /cache/i);
  await page.mouse.click(500, 365);
  await expect(page.getByTestId('component-panel')).toContainText('L2');
  expect((await getStoreState(page)).path).toEqual(['die']);

  await open(page, SUB);
  await expectTip(page, 700, 300, 'Tensor core', /matrix/i);
});
