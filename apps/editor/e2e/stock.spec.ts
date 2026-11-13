import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

// The Media manager's "Search stock images" modal: verifies the picker UI is wired up
// against the live editor (opens in a modal, provider list loaded from the API, search
// controls present, and the grid / preview / Load more against a stubbed search). The real
// provider search and import (outbound network, provider keys) are the API E2E's
// (apps/api/e2e/stock.spec.ts).

// A tiny valid 1x1 PNG, served for the stubbed stock images.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

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
  await expect(provider.locator('option')).toHaveCount(5); // all + openverse + unsplash + pexels + pixabay

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

test('stock picker: an ALL search renders a grid, notes a provider that did not answer, previews full size, and pages with Load more', async ({ page }) => {
  // The search is STUBBED: this drives the picker, not the providers. It used to go out to the live
  // keyless Openverse tier, and the editor gate went red whenever Openverse was slow (5–17 s a search,
  // some 504s, from about 2026-10-20) although nothing here had changed. The real server → provider
  // path is the API suite's (apps/api/e2e/stock.spec.ts).
  const hit = (i: number, provider: 'openverse' | 'unsplash' | 'pexels') => ({
    provider,
    id: `e2e-${i}`,
    thumbUrl: `https://stock-cdn.e2e.test/${i}-thumb.png`,
    previewUrl: `https://stock-cdn.e2e.test/${i}-large.png`,
    width: 1600,
    height: 1200,
    author: `Photographer ${i}`,
    sourceUrl: `https://stock-source.e2e.test/${i}`,
    license: 'CC0',
  });
  const pagesAsked: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith('/stock/search'),
    async (route) => {
      const asked = new URL(route.request().url()).searchParams;
      const n = asked.get('page') ?? '1';
      pagesAsked.push(n);
      const body =
        n === '1'
          ? {
              provider: 'all',
              page: 1,
              results: [1, 2, 3, 4, 5, 6].map((i) => hit(i, i % 2 ? 'unsplash' : 'pexels')),
              hasMore: true,
              // A slow provider is given up on and reported, while the others' results are shown.
              errors: [{ provider: 'openverse', error: 'openverse did not answer within 8 s' }],
            }
          : { provider: 'all', page: 2, results: [7, 8, 9, 10].map((i) => hit(i, 'unsplash')), hasMore: false };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
  await page.route('https://stock-cdn.e2e.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));

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

  const tiles = dialog.getByRole('button', { name: /^Preview stock photo by / });
  await expect(tiles).toHaveCount(6);
  await expect(dialog.getByText("Openverse (CC) did not respond — showing the other providers' results.")).toBeVisible();

  // Clicking a tile opens the full-size preview OVER the picker modal (a stacked dialog), showing
  // a LARGER rendition than the grid thumbnail — that is the whole point of the preview.
  const thumbSrc = await dialog.locator('figure img').first().getAttribute('src');
  await tiles.first().click();
  const previewDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Import this photo' }) });
  await expect(previewDialog).toBeVisible();
  const previewImg = previewDialog.locator('img').first();
  await expect(previewImg).toBeVisible();
  const previewSrc = await previewImg.getAttribute('src');
  expect(previewSrc).toBe('https://stock-cdn.e2e.test/1-large.png');
  expect(previewSrc).not.toBe(thumbSrc);
  // The preview image really loads (a broken URL would have naturalWidth 0).
  await expect.poll(() => previewImg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // Escape unwinds ONE overlay: the preview closes, the picker stays open.
  await page.keyboard.press('Escape');
  await expect(previewDialog).toBeHidden();
  await expect(dialog).toBeVisible();

  // Load more APPENDS the next page rather than replacing the grid, and goes away on the last page.
  await dialog.getByRole('button', { name: 'Load more' }).click();
  await expect(tiles).toHaveCount(10);
  await expect(dialog.getByRole('button', { name: 'Load more' })).toBeHidden();
  expect(pagesAsked).toEqual(['1', '2']);
});
