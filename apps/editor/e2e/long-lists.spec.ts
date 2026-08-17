import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

/**
 * The long-list behaviour, which NO other spec reaches: virtualisation is gated at
 * VIRTUAL_ROW_THRESHOLD (80 rows) and every other spec uses a handful of pages, so they all run the
 * unvirtualised path by design.
 *
 * ★ This is the spec the feature actually needed. The virtualiser shipped once as a silent no-op —
 * it typechecked, passed its unit tests, and rendered all 865 rows in a real browser because the rows
 * arrive AFTER the effect that measures them. Nothing in the suite could tell. So this asserts the DOM
 * genuinely shrank, that the window MOVES on scroll, and that reordering still works with most rows
 * absent from the DOM.
 */

const PAGES = 140; // comfortably over the threshold, small enough to seed quickly

test('a long pages list virtualises, scrolls, and still reorders', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  await signUp(page, `longlist-${stamp}@e2e.test`);

  // Seed over the API: 140 pages through the UI would be the test's whole runtime.
  const created = await page.request.post('/projects', { data: { name: 'Long', slug: `long${stamp}` } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const imported = await page.request.post(`/projects/${projectId}/import`, {
    data: {
      pages: [
        { id: 'home', path: '', title: 'Home', source: '<p>home</p>' },
        ...Array.from({ length: PAGES }, (_, i) => ({
          id: `p-${String(i).padStart(3, '0')}`,
          path: `p-${String(i).padStart(3, '0')}`,
          parent: 'home',
          order: (i + 1) * 65_536,
          title: `Page ${String(i).padStart(3, '0')}`,
          source: '<p>body</p>',
        })),
      ],
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);

  await page.goto(baseURL!);
  await page.getByText('Long', { exact: true }).first().click();

  const rows = page.locator('li[data-virtual-row]');
  await expect(rows.first()).toBeVisible();

  // ★ The DOM must actually be smaller than the list. A no-op virtualiser renders all 141.
  await expect
    .poll(async () => rows.count(), { message: 'only the visible window should be in the DOM', timeout: 20_000 })
    .toBeLessThan(80);
  expect(await rows.count()).toBeGreaterThan(5);
  // The row still reports its true position for assistive tech.
  expect(await rows.first().getAttribute('aria-setsize')).toBe(String(PAGES + 1));

  const firstBefore = await rows.first().getAttribute('aria-posinset');
  await page.mouse.wheel(0, 4000);
  await expect
    .poll(async () => rows.first().getAttribute('aria-posinset'), { message: 'the window should follow the scroll', timeout: 20_000 })
    .not.toBe(firstBefore);
  expect(await rows.count(), 'still a window, not the whole list').toBeLessThan(80);

  // Reorder two rows that are BOTH in the current window. The ids are resolved against the full list,
  // not the DOM, so this is the property virtualisation must not have broken.
  await page.mouse.wheel(0, -10_000);
  await expect.poll(async () => rows.first().getAttribute('aria-posinset'), { timeout: 20_000 }).toBe('1');

  const orderBefore = await page.request.get(`/projects/${projectId}/content/page/p-000`);
  const before = (await orderBefore.json()).item.order as number;

  const source = page.locator('li[data-virtual-row]').nth(1); // p-000 (row 0 is Home)
  const target = page.locator('li[data-virtual-row]').nth(4);
  await source.hover();
  await page.mouse.down();
  await target.hover();
  await target.hover(); // a second move so dragover fires on the target with a settled position
  await page.mouse.up();

  await expect
    .poll(
      async () => (await (await page.request.get(`/projects/${projectId}/content/page/p-000`)).json()).item.order,
      { message: 'the dragged page should have been given a new order', timeout: 20_000 },
    )
    .not.toBe(before);

  // ★ And exactly ONE page moved: a dense reindex would have rewritten every later sibling.
  const all = (await (await page.request.get(`/projects/${projectId}/content/page`)).json()).items as Array<{
    id: string;
    order?: number;
  }>;
  const unchanged = all.filter((p) => p.id.startsWith('p-') && p.id !== 'p-000' && p.order === (Number(p.id.slice(2)) + 1) * 65_536);
  expect(unchanged.length, 'every other sibling should keep its original order').toBe(PAGES - 1);
});
