import { expect, test } from '@playwright/test';
import { resolveKernel } from '../src/plan/kernels.ts';
import { timelineFor } from '../src/playback/playback.ts';
import { layerMarks } from '../src/timeline/timeline.ts';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

test('scrubbing to layer 3 puts the scene on a kernel of layer 3; playing moves the playhead', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await setStoreState(page, { path: ['die'], picks: [0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);

  const state = await getStoreState(page);
  const plan = state.plan;
  if (!plan) throw new Error('no plan');
  // Layer 0 is in detail; layer 3 is folded. The scene starts on layer 0's QKV GEMM.
  expect(state.sceneKernel?.op.layer).toBe(0);
  const segments = timelineFor(plan, 'didactic', 0);
  const at = layerMarks(segments).find((m) => m.layer === 3)?.at;
  if (at === undefined) throw new Error('no mark for layer 3');
  const layer3 = segments.find((s) => s.layer === 3);
  if (!layer3) throw new Error('no layer 3 segment');

  // A range input has no `fill` that React hears; this is what dragging does.
  await page.getByRole('slider', { name: 'Timeline' }).evaluate((el, value) => {
    const input = el as unknown as { value: string; dispatchEvent(e: unknown): void; ownerDocument: { defaultView: { Event: new (t: string, o: object) => unknown; HTMLInputElement: { prototype: object } } } };
    const win = input.ownerDocument.defaultView;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to the input below
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
    if (setter) Reflect.apply(setter, input, [String(value)]);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  }, at + layer3.duration / 2);
  // Folded: the scene shows the layer's summary, holding the layer's first kernel (ADR 0024).
  const scrubbed = await waitForStore(page, (s) => s.summary?.layer === 3);
  expect(scrubbed.summary).toEqual({ layer: 3, why: 'folded' });
  expect(scrubbed.sceneKernel && resolveKernel(plan, scrubbed.sceneKernel)?.layer).toBe(3);
  await expect(page.getByTestId('transport-now')).toContainText('layer 3');
  await expect(page.getByRole('complementary', { name: 'Data flow' })).toContainText('Layer 3');

  // Choosing the layer opens it kernel by kernel, from its first kernel.
  await page.getByTestId('transport').getByRole('combobox', { name: 'Layer' }).selectOption('3');
  const opened = await waitForStore(page, (s) => s.focusLayer === 3);
  expect(opened.focusLayer).toBe(3);
  // The layer's first kernel also holds the layer before's residual add, so its first op is layer 2's.
  const first = opened.sceneKernel && resolveKernel(plan, opened.sceneKernel);
  expect(first?.layer).toBe(3);
  expect(first).toBe(plan.kernels[plan.layers[3]?.start ?? -1]);

  // Play: the playhead moves, and pause stops it.
  const before = (await getStoreState(page)).playhead ?? 0;
  await page.getByRole('button', { name: 'Play' }).click();
  await waitForStore(page, (s) => (s.playhead ?? 0) > before + 0.3);
  await page.getByRole('button', { name: 'Pause' }).click();
  await waitForStore(page, (s) => s.playing === false);
  const paused = (await getStoreState(page)).playhead ?? 0;
  expect(paused).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  expect((await getStoreState(page)).playhead).toBe(paused);
  expect(errors).toEqual([]);
});
