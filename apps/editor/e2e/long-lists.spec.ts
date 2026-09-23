import { test, expect, type Page, type Locator } from '@playwright/test';
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

/**
 * Drive a NATIVE HTML5 drag from one row to another, waiting on the two states the component actually
 * exposes instead of hoping the events landed.
 *
 * ★ The flake this replaces cost several full-suite runs to pin down, and it failed on main too — so it
 * was never about whatever was being changed at the time. `hover() → mouse.down() → hover() → up()`
 * jumps the pointer in ONE move. Native DnD only fires `dragstart` once the pointer travels while the
 * button is held, so under load that sequence frequently dragged nothing at all: no dragstart, no
 * dragover, a `drop` the handler ignores because `dragId` is null, and a 20s poll for an order that was
 * never going to change. It passed in isolation and failed about half the time inside the full suite,
 * which is exactly the signature of a gesture that is racing rather than a product that is broken.
 *
 * So: move in STEPS (the intermediate moves are what start the drag), then assert `data-dragging` —
 * proof the drag exists — then move onto the target and wait for its `data-drop-indicator` — proof the
 * target accepted the dragover — and only then release. Each wait fails with its own message, so a real
 * regression still reports which half broke.
 */
async function dragRow(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag: a row had no box');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Cross the drag threshold WHILE the button is held — this is what fires dragstart.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 6 });
  await expect(source, 'the drag should have started (dragstart never fired)').toHaveAttribute('data-dragging', '', {
    timeout: 10_000,
  });

  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  // ANY indicator, not one on `target` specifically. `onDragOver` resolves the nearest LEGAL row and a
  // position within it, so landing mid-row legitimately paints "after the row above" — the same visual
  // gap, a different element. Asserting the indicator on `target` made the test demand an implementation
  // detail it does not care about; what it needs to know is that SOME legal drop was registered, and
  // the order assertion afterwards is what checks the page actually moved.
  await expect(
    page.locator('[data-drop-indicator]').first(),
    'the list should have registered a legal drop target',
  ).toBeVisible({ timeout: 10_000 });
  await page.mouse.up();
}

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
  await dragRow(page, source, target);

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

/**
 * The DATASET ENTRIES list, which lives in the Data side panel.
 *
 * ★ A window-level `scroll` listener never fires for a scroll inside a container — scroll events do not
 * bubble. So this list's virtualised window FROZE at its initial range: scrolling the panel revealed
 * the reserved blank space where the later rows should have been. Measured, with the capturing listener
 * removed, the first rendered row never changes however far the panel scrolls. Nothing covered this
 * path, in either direction, which is why it went unnoticed.
 */
const ENTRIES = 140;

test('a long dataset-entry list virtualises and follows the PANEL’s scroll', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  await signUp(page, `longentries-${stamp}@e2e.test`);

  const created = await page.request.post('/projects', { data: { name: 'Entries', slug: `entries${stamp}` } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const imported = await page.request.post(`/projects/${projectId}/import`, {
    data: {
      pages: [{ id: 'home', path: '', title: 'Home', source: '<p>home</p>' }],
      datasets: [{ id: 'news', name: 'News', slug: 'news', fields: [{ name: 'title', type: 'text' }] }],
      entries: Array.from({ length: ENTRIES }, (_, i) => ({
        id: `e${String(i).padStart(3, '0')}`,
        dataset: 'news',
        status: 'published' as const,
        order: (i + 1) * 65_536,
        values: { title: `Entry ${String(i).padStart(3, '0')}` },
      })),
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);

  await page.goto(baseURL!);
  await page.getByText('Entries', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open Datasets' }).click();
  await page.getByText('News', { exact: true }).first().click();
  await expect(page.getByText('Entry 000')).toBeVisible({ timeout: 60_000 });

  // ★ Scoped by CONTENT, not by the marker alone: the pages list on the same screen uses the same
  // `data-virtual-row` attribute, and a bare selector silently measures that list instead — which is
  // exactly what this test did on its first run, passing vacuously against a 1-page project.
  const rowSel = 'li[data-virtual-row]';
  const before = await page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)].filter((r) => /Entry \d{3}/.test(r.textContent ?? ''));
    return { count: rows.length, first: rows[0]?.textContent?.trim() ?? '' };
  }, rowSel);
  expect(before.count, 'the entries list must render a window, not all 140').toBeLessThan(ENTRIES);
  expect(before.count).toBeGreaterThan(0);

  // Scroll the PANEL — the window never moves here, which is exactly the case that was broken.
  const scrolled = await page.evaluate((sel) => {
    const row = [...document.querySelectorAll(sel)].find((r) => /Entry \d{3}/.test(r.textContent ?? ''));
    for (let el = row?.parentElement ?? null; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') {
        el.scrollTop = Math.floor(el.scrollHeight * 0.6);
        return true;
      }
    }
    return false;
  }, rowSel);
  expect(scrolled, 'the entries list must sit inside a scrolling panel body').toBe(true);
  await page.waitForTimeout(600);

  const after = await page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)].filter((r) => /Entry \d{3}/.test(r.textContent ?? ''));
    return { count: rows.length, first: rows[0]?.textContent?.trim() ?? '' };
  }, rowSel);
  expect(after.first, 'the window must follow the panel’s scroll').not.toBe(before.first);
  expect(after.count, 'and stay a window afterwards').toBeLessThan(ENTRIES);
});
