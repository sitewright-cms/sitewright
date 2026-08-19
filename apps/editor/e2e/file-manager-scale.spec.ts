import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

/**
 * The FILE MANAGER at a real media-library size, in a real browser.
 *
 * Measured on a deployed instance before this: 3,000 assets in one folder rendered **75,686 DOM nodes**
 * and **3,000 `<img>` elements**, a 78MB JS heap and ~334ms per search keystroke — 1.8x worse than the
 * pages list was before it was virtualised. The API was never the problem (0.84MB in 42ms); the browser
 * was.
 *
 * ★ This has to run in a browser. jsdom performs no layout, so every measured height is 0 and the
 * virtualiser takes its deliberate render-everything fallback — a jsdom test can prove the wiring but
 * never that anything actually narrowed. That distinction is exactly how this feature shipped as a
 * silent no-op the first time.
 *
 * ★ And it has to run in the PANEL. The file manager scrolls the side panel's own `overflow-auto` body,
 * not the window — so the window has to follow the PANEL's scroll, and be sized by the panel rather
 * than the viewport.
 */

const ASSETS = 900;

/** One media row per asset — the import bundle carries media, so the whole library seeds in one call. */
function library(n: number) {
  return {
    pages: [{ id: 'home', path: '', title: 'Home', source: '<p>home</p>' }],
    media: Array.from({ length: n }, (_, i) => ({
      kind: 'image' as const,
      id: `m${String(i).padStart(4, '0')}`,
      filename: `photo-${String(i).padStart(4, '0')}.png`,
      folder: '',
      bytes: 120_537,
      format: 'png',
      width: 1600,
      height: 1067,
      hasAlpha: false,
      animated: false,
      original: `photo-${String(i).padStart(4, '0')}.png`,
      alt: `Archive photograph ${i}`,
      // The bytes do not exist on disk; the thumbnails 404, which is fine — what is measured here is
      // how many rows and requests the browser CREATES, not what comes back.
      url: `/media/p/m${String(i).padStart(4, '0')}/photo-${String(i).padStart(4, '0')}.png`,
    })),
  };
}

async function openFileManager(page: import('@playwright/test').Page, baseURL: string, tag: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  await signUp(page, `${tag}-${stamp}@e2e.test`);
  const created = await page.request.post('/projects', { data: { name: `Files ${stamp}`, slug: `${tag}${stamp}` } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;

  const imported = await page.request.post(`/projects/${projectId}/import`, { data: library(ASSETS) });
  expect(imported.status(), await imported.text()).toBe(200);

  await page.goto(baseURL);
  await page.getByText(`Files ${stamp}`, { exact: true }).first().click();
  await page.getByRole('button', { name: /File Manager/i }).first().click();
  await expect(page.getByText('photo-0000.png')).toBeVisible({ timeout: 60_000 });
  return { projectId };
}

test('★ a 900-asset library renders a WINDOW, not every row', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await openFileManager(page, baseURL!, 'fmscale');

  // ★ Scoped to `tr`: the PAGES list marks its rows with the same attribute, so a bare
  // `[data-virtual-row]` counts both lists and quietly measures the wrong one.
  const stats = await page.evaluate(() => ({
    rows: document.querySelectorAll('tr[data-virtual-row]').length,
    spacers: document.querySelectorAll('tr[data-virtual-spacer]').length,
  }));

  // Only what fits the panel plus overscan — nothing like the 900 rows the list holds.
  expect(stats.rows, 'the panel mounts only the rows on screen').toBeLessThan(120);
  expect(stats.rows).toBeGreaterThan(0);
  expect(stats.spacers, 'the skipped rows still occupy their height').toBeGreaterThan(0);
  // NOT asserted here: `document.images.length`. These fixtures have no bytes on disk, so every
  // thumbnail 404s and the skeleton swaps the <img> out — the count reads 0 whether the list is
  // windowed or not, which would pass vacuously. The thumbnail count is pinned by REQUESTS below.
});

test('★ thumbnails ask for the SMALL rung, not the 2400px default', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const requested: string[] = [];
  // Only DELIVERY urls (/media/<slug>/<file>.<ext>) — the API's own /media and /media/folders reads
  // share the prefix and would otherwise read as un-sized thumbnails.
  // (The delivery path admits an optional middle segment, so match on the file extension instead of a
  // fixed depth.)
  const DELIVERY = /\/media\/.+\.(?:png|jpe?g|webp|avif|gif|svg)(?:\?|$)/i;
  page.on('request', (r) => {
    if (DELIVERY.test(r.url())) requested.push(r.url());
  });
  await openFileManager(page, baseURL!, 'fmthumb');
  await page.waitForTimeout(1500);

  expect(requested.length, 'the visible rows fetch their thumbnails').toBeGreaterThan(0);
  // ★ …and only the visible ones. Before this, 3,000 rows meant 3,000 thumbnail requests, each a
  // 2400px on-demand encode on the server.
  expect(requested.length, 'a windowed list fetches a window of thumbnails').toBeLessThan(120);
  // A bare media URL serves `xl` — 2400px wide — into a 32px icon. Every request must name a size.
  const bare = requested.filter((u) => !u.includes('size='));
  expect(bare, `these fetched the 2400px rung: ${bare.slice(0, 3).join(', ')}`).toHaveLength(0);
  // The LIST asks for `xs` (150px) — a 32px icon with room for the 4x hover zoom. `sm` (500px) was
  // itself 15x the painted size; the grid tile still uses it, but this view is the list.
  expect(requested.every((u) => u.includes('size=xs'))).toBe(true);
});

test('★ scrolling the PANEL moves the window (the panel scrolls, not the page)', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await openFileManager(page, baseURL!, 'fmscroll');

  const firstRow = 'tr[data-virtual-row]'; // `tr` — the pages list uses the same marker on its `li`s
  const firstBefore = await page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? '', firstRow);
  // Scroll the panel body itself — the window never moves here, which is the whole point.
  const scrolled = await page.evaluate((sel) => {
    const row = document.querySelector(sel);
    for (let el = row?.parentElement ?? null; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') {
        el.scrollTop = Math.floor(el.scrollHeight / 2);
        return true;
      }
    }
    return false;
  }, firstRow);
  expect(scrolled, 'the file list must sit inside a scrolling panel body').toBe(true);
  await page.waitForTimeout(600);

  const firstAfter = await page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? '', firstRow);
  expect(firstAfter, 'the window must follow the panel’s scroll').not.toBe(firstBefore);
  const rows = await page.evaluate((sel) => document.querySelectorAll(sel).length, firstRow);
  expect(rows, 'and it must stay a window after scrolling').toBeLessThan(120);
});

test('★ SEARCH spans every folder, so it must stay windowed too', async ({ page, baseURL }) => {
  // Foldering hides the problem (30 folders of 100 render ~1,200 nodes) but does not fix it: one broad
  // query puts the whole library back on screen regardless of how it is filed.
  test.setTimeout(180_000);
  await openFileManager(page, baseURL!, 'fmsearch');

  const t0 = Date.now();
  await page.getByPlaceholder(/search/i).first().fill('photo');
  await expect(page.getByText('photo-0000.png')).toBeVisible({ timeout: 30_000 });
  const elapsed = Date.now() - t0;

  const rows = await page.evaluate(() => document.querySelectorAll('tr[data-virtual-row]').length);
  expect(rows, 'a search matching all 900 assets must still render a window').toBeLessThan(120);
  expect(elapsed, 'and it must stay responsive').toBeLessThan(5_000);
});

test('the GRID view windows in whole rows, keeping columns aligned', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  await openFileManager(page, baseURL!, 'fmgrid');

  await page.getByRole('button', { name: /grid view/i }).first().click();
  await expect(page.locator('figure[data-virtual-row]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);

  const grid = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('figure[data-virtual-row]')] as HTMLElement[];
    const firstTop = cells[0]?.offsetTop ?? 0;
    return { count: cells.length, inFirstRow: cells.filter((c) => c.offsetTop === firstTop).length };
  });

  expect(grid.count, 'the grid mounts a window too').toBeLessThan(200);
  expect(grid.count).toBeGreaterThan(0);
  // A window starting mid-row would leave a short first row and shift every tile a column over.
  expect(grid.count % grid.inFirstRow, 'the window must start and end on row boundaries').toBe(0);
});
