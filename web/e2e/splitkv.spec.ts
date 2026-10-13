import { expect, test } from '@playwright/test';
import { timelineFor } from '../src/playback/playback.ts';
import { getRenderInfo, getStoreState, setStoreState, waitForStore } from './helpers.ts';

test('decode attention at batch 1 and 8k lights 104 SMs: 8 KV heads × 13 splits', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  // To the die, as a click would (navigation.spec covers the clicks).
  await setStoreState(page, { path: ['die'], picks: [0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);

  const card = page.getByTestId('occupancy');
  await expect(card).toBeVisible();
  // The default scenario is the lesson's: decode BF16, batch 1, 8k (design §6.6).
  await card.getByLabel('Kernel').selectOption({ label: 'attention · layer 0' });

  const { plan, sceneKernel } = await getStoreState(page);
  expect(sceneKernel).toEqual({ op: { kind: 'attention', layer: 0 }, nth: 0 });
  const attention = plan?.kernels.find((k) => k.layer === 0 && k.impl === 'fa3');
  if (!attention) throw new Error('the plan has no FA3 kernel in layer 0');
  expect(attention.grid.perWave).toEqual([104]);

  await expect(page.getByTestId('occupancy-busy')).toHaveText('104');
  await expect(page.getByTestId('occupancy-wave')).toHaveText('1');
  const split = page.getByTestId('split-kv');
  await expect(split).toContainText('8 KV heads × 13 splits');
  await expect(page.getByTestId('split-kv-blocks')).toHaveText('104');
  await expect(split.locator('.occupancy-grid span')).toHaveCount(104);
  // The flow label follows the scene's kernel, and its bytes are now the KV cache's.
  await expect(page.getByRole('complementary', { name: 'Data flow' })).toContainText('attention · layer 0');
  await expect(page.getByTestId('flow-bytes')).toHaveText(
    `${attention.bytes.hbmRead.value.toLocaleString('en-US')} B`,
  );

  // Into a GPC: round-robin puts 13 of the 104 blocks in each of the 8 (ADR 0020).
  await setStoreState(page, { path: ['die', 'gpc-8tpc'], picks: [0, 2], from: ['die'] });
  await waitForStore(page, (s) => s.path?.length === 2 && s.from === null);
  await expect(page.getByTestId('occupancy-gpc-busy')).toHaveText('13');
  await expect(page.getByTestId('occupancy-busy')).toHaveText('104');

  // The highlight costs no draw calls: the SMs stay one instanced mesh.
  const info = await getRenderInfo(page);
  expect(info.calls).toBeLessThanOrEqual(200);
  expect(errors).toEqual([]);
});

test('a GEMM with more blocks than SMs takes turns in waves', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await setStoreState(page, { path: ['die'], picks: [0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);

  const card = page.getByTestId('occupancy');
  await card.getByLabel('Kernel').selectOption({ label: 'gate/up projection · layer 0' });
  const { plan } = await getStoreState(page);
  const gateUp = plan?.kernels.find((k) => k.layer === 0 && k.ops.some((o) => o.kind === 'gate_up_proj'));
  if (!plan || !gateUp) throw new Error('the plan has no gate/up GEMM in layer 0');
  const waves = gateUp.grid.perWave;
  expect(waves.length).toBeGreaterThan(1);
  await expect(card).toContainText(`of ${String(waves.length)}`);
  // The waves follow the playhead: the end of the kernel is its last, partial wave.
  await expect(page.getByTestId('occupancy-wave')).toHaveText('1');
  const { playhead, timeMode, focusLayer } = await getStoreState(page);
  const segments = timelineFor(plan, timeMode ?? 'didactic', focusLayer ?? null);
  const segment = segments.find((s) => s.first <= plan.kernels.indexOf(gateUp) && plan.kernels.indexOf(gateUp) < s.end);
  if (!segment || playhead === undefined) throw new Error('the kernel is not on the timeline');
  await setStoreState(page, { playhead: segment.start + segment.duration - 1e-6 });
  await expect(page.getByTestId('occupancy-wave')).toHaveText(String(waves.length));
  await expect(page.getByTestId('occupancy-busy')).toHaveText(String(Math.min(waves.at(-1) ?? 0, 132)));
});
