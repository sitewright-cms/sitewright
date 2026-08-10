import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

// The Media manager's "Search stock images" modal: verifies the picker UI is wired up
// against the live editor (opens in a modal, provider list loaded from the API, search
// controls present). The real provider search/import (which needs provider keys + outbound
// network) is covered deterministically by the API E2E (apps/api/e2e/stock.spec.ts).

test('media manager exposes a Stock images picker with a loaded provider list', async ({ page }) => {
  await signUp(page, `stock-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Stock Site');
  await page.getByLabel('Project slug').fill(`stock-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open File Manager' }).click();

  // Open the stock picker in a modal (it replaced the inner "Stock images" tab).
  await page.getByRole('button', { name: 'Search stock images' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search stock images' });
  await expect(dialog).toBeVisible();

  // The provider select loads from the API and defaults to ALL (fan out across every available
  // provider); the individual providers remain selectable.
  const provider = dialog.getByLabel('Stock provider');
  await expect(provider).toBeVisible();
  await expect(provider).toHaveValue('all');
  await expect(provider.locator('option')).toHaveCount(4); // all + openverse + unsplash + pexels

  // Search controls are present. ALL is searchable because keyless Openverse is always available,
  // so with a query the Search button is enabled (order-independent of any instance key config).
  const query = dialog.getByLabel('Stock search query');
  await expect(query).toBeVisible();
  await query.fill('mountains');
  await expect(dialog.getByRole('button', { name: 'Search' })).toBeEnabled();

  // The modal closes cleanly.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('stock picker: an ALL search renders a grid, previews full size, and pages with Load more', async ({ page }) => {
  await signUp(page, `stockui-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Stock UI');
  await page.getByLabel('Project slug').fill(`stockui-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open File Manager' }).click();
  await page.getByRole('button', { name: 'Search stock images' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search stock images' });
  await dialog.getByLabel('Stock search query').fill('mountains');
  await dialog.getByRole('button', { name: 'Search' }).click();

  // The default ALL search goes out to the live keyless Openverse tier. That tier is
  // rate-limited, so an empty page is a legitimate outcome — assert the UI only when there
  // is something to assert, exactly as the API suite's keyless import test does.
  const tiles = dialog.getByRole('button', { name: /^Preview stock photo by / });
  await expect(dialog.getByRole('button', { name: 'Search' })).toBeEnabled({ timeout: 30_000 });
  const count = await tiles.count();
  test.skip(count === 0, 'the keyless Openverse tier returned no results (rate limited)');

  // Clicking a tile opens the full-size preview OVER the picker modal (a stacked dialog), showing
  // a LARGER rendition than the grid thumbnail — that is the whole point of the preview.
  const thumbSrc = await dialog.locator('figure img').first().getAttribute('src');
  await tiles.first().click();
  const previewDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Import this photo' }) });
  await expect(previewDialog).toBeVisible();
  const previewImg = previewDialog.locator('img').first();
  await expect(previewImg).toBeVisible();
  const previewSrc = await previewImg.getAttribute('src');
  expect(previewSrc).toMatch(/^https:\/\//);
  expect(previewSrc).not.toBe(thumbSrc);
  // The preview image really loads (a broken URL would have naturalWidth 0).
  await expect
    .poll(() => previewImg.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Escape unwinds ONE overlay: the preview closes, the picker stays open.
  await page.keyboard.press('Escape');
  await expect(previewDialog).toBeHidden();
  await expect(dialog).toBeVisible();

  // Load more APPENDS the next page rather than replacing the grid.
  const more = dialog.getByRole('button', { name: 'Load more' });
  if (await more.isVisible()) {
    const before = await tiles.count();
    await more.click();
    await expect.poll(() => tiles.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  }
});
