import { expect, test, type Page } from '@playwright/test';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

const G = 'gpc-8tpc';

/** Opens the panel of an SM, whose prose has the term "thread blocks" (inside it, "SM"). */
async function openSmPanel(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await setStoreState(page, { path: ['die', G, `${G}/tpc/sm`], picks: [0, 0, 0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 3 && s.from === null);
  await page.getByRole('button', { name: 'About this sm' }).click();
  const panel = page.getByTestId('component-panel');
  await expect(panel).toBeVisible();
  // The click left the pointer over the panel.
  await page.mouse.move(1, 1);
  return panel;
}

test('a term opens a tooltip on hover, a nested one inside it, and Escape closes them one at a time', async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await openSmPanel(page);
  const tips = page.getByRole('tooltip');
  const term = panel.locator('.term[data-term="thread-block"]').first();

  await term.hover();
  await expect(tips).toHaveCount(1);
  await expect(tips.first()).toContainText('Thread block (CTA)');

  // Into the tooltip, onto a term in its text: a second one opens inside the first.
  await tips.first().locator('.term[data-term="sm"]').hover();
  await expect(tips).toHaveCount(2);
  await expect(tips.nth(1)).toContainText('Streaming multiprocessor');

  await page.keyboard.press('Escape');
  await expect(tips).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tips).toHaveCount(0);
  expect((await getStoreState(page)).path?.length).toBe(3);
});

test('a tooltip pins on click and stays after the pointer leaves, and an unpinned one goes away', async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await openSmPanel(page);
  const tips = page.getByRole('tooltip');
  const term = panel.locator('.term[data-term="thread-block"]').first();

  await term.hover();
  await expect(tips).toHaveCount(1);
  await page.mouse.move(1, 1);
  await expect(tips).toHaveCount(0);

  await term.hover();
  await expect(tips).toHaveCount(1);
  await term.click();
  await expect(tips.first()).toContainText('Related');
  await page.mouse.move(1, 1);
  await page.waitForTimeout(600);
  await expect(tips).toHaveCount(1);

  // A press outside closes it.
  await page.mouse.click(1, 300);
  await expect(tips).toHaveCount(0);
});

test('a tooltip pins itself after a while', async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await openSmPanel(page);
  const tips = page.getByRole('tooltip');
  await panel.locator('.term[data-term="thread-block"]').first().hover();
  await expect(tips).toHaveCount(1);
  await expect(tips.first()).not.toContainText('Related');
  await expect(tips.first()).toContainText('Related', { timeout: 3000 });
});

test('the same works with the keyboard', async ({ page }) => {
  test.setTimeout(60_000);
  const panel = await openSmPanel(page);
  const tips = page.getByRole('tooltip');
  const term = panel.locator('.term[data-term="thread-block"]').first();

  await term.focus();
  await expect(tips).toHaveCount(1);
  // Tab goes into the tooltip, to the term in its text, which opens a nested one.
  await page.keyboard.press('Tab');
  await expect(tips).toHaveCount(2);
  await expect(tips.nth(1)).toContainText('Streaming multiprocessor');
  await expect(page.locator('.term[data-term="sm"]:focus')).toHaveCount(1);

  // Escape closes the nested tooltip and gives the focus back to its term.
  await page.keyboard.press('Escape');
  await expect(tips).toHaveCount(1);
  await expect(page.locator('.term[data-term="sm"]:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tips).toHaveCount(0);
  await expect(term).toBeFocused();
  expect((await getStoreState(page)).path?.length).toBe(3);
});

test('a part of the 3D shows its component\'s tooltip on hover', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // The die sits at the center of the initial view.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const tip = page.getByRole('tooltip');
  await expect(tip).toHaveCount(1);
  await expect(tip).toContainText('GH100 die');
  await expect(tip).toContainText('on-chip network');

  // Moving into the box pins it, and its terms open nested tooltips.
  await tip.hover();
  await tip.locator('.term').first().hover();
  await expect(page.getByRole('tooltip')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect((await getStoreState(page)).path?.length).toBe(0);
});
