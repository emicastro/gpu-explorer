import { expect, test } from '@playwright/test';
import { getRenderInfo, setStoreState, waitForStore } from './helpers.ts';

/** Frame budget (R12; design §6.7). */
const MAX_DRAW_CALLS = 200;
const MAX_TRIANGLES = 500_000;

/** The levels under one GPC variant; the die has GPCs of 8 and of 9 TPCs. */
const underGpc = (gpc: string) => {
  const sm = `${gpc}/tpc/sm`;
  return [
    { name: gpc, path: ['die', gpc], picks: [0, 0] },
    { name: `${gpc} SM`, path: ['die', gpc, sm], picks: [0, 0, 0] },
    { name: `${gpc} sub-partition`, path: ['die', gpc, sm, `${sm}/subpartition`], picks: [0, 0, 0, 0] },
  ];
};

/** Every level, reached through the store: the path and the instance picked at each step. */
const LEVELS = [
  { name: 'package', path: [] as string[], picks: [] as number[] },
  { name: 'die', path: ['die'], picks: [0] },
  ...underGpc('gpc-8tpc'),
  ...underGpc('gpc-9tpc'),
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
  let from: string[] = [];
  for (const level of LEVELS) {
    // A non-null `from` starts a flight, as the navigation reducer would; the
    // scene clears it on landing, which is when the new level mounts.
    await setStoreState(page, { path: level.path, picks: level.picks, from });
    const landed = await waitForStore(page, (s) => s.from === null);
    expect(landed.from, `${level.name}: the flight did not land`).toBeNull();
    from = level.path;
    // A few frames at the new level, so the counts are its own.
    await page.waitForTimeout(200);
    const info = await getRenderInfo(page);
    seen.push(`${level.name}: ${JSON.stringify(info)}`);
    expect(info.calls, `${level.name} draw calls`).toBeGreaterThan(0);
    expect(info.calls, `${level.name} draw calls`).toBeLessThanOrEqual(MAX_DRAW_CALLS);
    expect(info.triangles, `${level.name} triangles`).toBeLessThanOrEqual(MAX_TRIANGLES);
  }
  console.log(`budget per level\n${seen.join('\n')}`);
  expect(errors).toEqual([]);
});
