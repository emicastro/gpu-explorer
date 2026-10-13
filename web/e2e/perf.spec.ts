import { expect, test } from '@playwright/test';
import { getRenderInfo, setStoreState, waitForStore } from './helpers.ts';

/** Frame budget (R12; design §6.7). */
const MAX_DRAW_CALLS = 200;
const MAX_TRIANGLES = 500_000;

const GPC = 'gpc-8tpc';
const SM = `${GPC}/tpc/sm`;
const SUB = `${SM}/subpartition`;

/** Every level, reached through the store: the path and the instance picked at each step. */
const LEVELS = [
  { name: 'package', path: [] as string[], picks: [] as number[] },
  { name: 'die', path: ['die'], picks: [0] },
  { name: 'GPC', path: ['die', GPC], picks: [0, 0] },
  { name: 'SM', path: ['die', GPC, SM], picks: [0, 0, 0] },
  { name: 'sub-partition', path: ['die', GPC, SM, SUB], picks: [0, 0, 0, 0] },
];

test('every level stays within the frame budget', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  const seen: string[] = [];
  for (const level of LEVELS) {
    await setStoreState(page, { path: level.path, picks: level.picks, from: null });
    await waitForStore(page, (s) => s.path?.length === level.path.length && s.from === null);
    // Let the camera settle and a few frames render at the new level.
    await page.waitForTimeout(1_500);
    const info = await getRenderInfo(page);
    seen.push(`${level.name}: ${JSON.stringify(info)}`);
    expect(info.calls, `${level.name} draw calls`).toBeGreaterThan(0);
    expect(info.calls, `${level.name} draw calls`).toBeLessThanOrEqual(MAX_DRAW_CALLS);
    expect(info.triangles, `${level.name} triangles`).toBeLessThanOrEqual(MAX_TRIANGLES);
  }
  console.log(`budget per level\n${seen.join('\n')}`);
  expect(errors).toEqual([]);
});
