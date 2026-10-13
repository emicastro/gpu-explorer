import { expect, test } from '@playwright/test';
import { timelineFor } from '../src/playback/playback.ts';
import { layerMarks } from '../src/timeline/timeline.ts';
import { getStoreState, setStoreState, waitForStore } from './helpers.ts';

interface Change {
  at: number;
  text: string;
  folded: boolean;
}

// Runs in the page (the project has no DOM lib, so it is a string).
const SAMPLE_LABEL = `new Promise((resolve) => {
  const out = [];
  const start = performance.now();
  let last = '';
  const frame = (now) => {
    const label = document.querySelector('[aria-label="Data flow"]');
    const text = (label?.textContent ?? '').replace(/\\s+/g, ' ');
    if (text !== last) {
      out.push({ at: now - start, text, folded: label?.querySelector('[data-testid="flow-summary"]') != null });
      last = text;
    }
    if (now - start < 2000) requestAnimationFrame(frame);
    else resolve(out);
  };
  requestAnimationFrame(frame);
})`;

// Layers other than the focused one are folded; each lasts ~0.2 s at 1×. The scene must not
// flip through their ~11 kernels one by one (ADR 0024).
test('playing at 1× over folded layers changes the flow label at most once every 0.15 s', async ({ page }) => {
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

  const { plan } = await getStoreState(page);
  if (!plan) throw new Error('no plan');
  const at = layerMarks(timelineFor(plan, 'didactic', 0)).find((m) => m.layer === 2)?.at;
  if (at === undefined) throw new Error('no mark for layer 2');
  await setStoreState(page, { playhead: at + 0.01, speed: 1 });
  await waitForStore(page, (s) => s.summary?.layer === 2);

  await page.getByRole('button', { name: 'Play' }).click();
  // The page samples the label every frame for 2 s of wall time and reports when its words changed.
  const changes = await page.evaluate<Change[]>(SAMPLE_LABEL);
  await page.getByRole('button', { name: 'Pause' }).click();

  // The first sample is the starting text, not a change. A layer lasts >= 150 ms; sampling per frame
  // blurs each edge by a frame, so allow 120. The strobe this replaces changed every ~15 ms.
  const gaps = changes.slice(1).map((c, i) => c.at - (changes[i]?.at ?? 0));
  expect(Math.min(...gaps, Infinity)).toBeGreaterThanOrEqual(120);
  // It really crossed folded layers: more than one layer's summary showed, and each said it was folded.
  const summaries = changes.filter((c) => c.folded);
  expect(summaries.length).toBeGreaterThan(2);
  for (const c of summaries) expect(c.text).toContain('folded');
  expect(errors).toEqual([]);
});

test('a folded layer says it is folded and how to unfold; the Layer selector unfolds it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await setStoreState(page, { path: ['die'], picks: [0], from: [] });
  await waitForStore(page, (s) => s.path?.length === 1 && s.from === null);
  const { plan } = await getStoreState(page);
  if (!plan) throw new Error('no plan');
  const at = layerMarks(timelineFor(plan, 'didactic', 0)).find((m) => m.layer === 4)?.at;
  if (at === undefined) throw new Error('no mark for layer 4');
  await setStoreState(page, { playhead: at + 0.01 });
  await waitForStore(page, (s) => s.summary?.layer === 4);

  const label = page.getByRole('complementary', { name: 'Data flow' });
  await expect(label).toContainText('Layer 4');
  await expect(label).toContainText('Layer selector');
  await expect(page.getByTestId('occupancy-busy')).toBeVisible();

  await page.getByTestId('transport').getByRole('combobox', { name: 'Layer' }).selectOption('4');
  const opened = await waitForStore(page, (s) => s.focusLayer === 4 && s.summary === null);
  expect(opened.summary).toBeNull();
  await expect(page.getByTestId('flow-summary')).toHaveCount(0);
});
