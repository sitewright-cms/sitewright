import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

/**
 * The pages-row context menu: right-click, long-press (touch) and keyboard, plus the two things it
 * exists to make possible — Duplicate landing next to its source, and Move to for distances a drag
 * cannot cover (a browser auto-scrolls a drag at ~200px/s, so 700 rows is minutes of holding a button).
 */

const PAGES = 12;

async function seed(page: import('@playwright/test').Page, tag: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  await signUp(page, `${tag}-${stamp}@e2e.test`);
  const created = await page.request.post('/projects', { data: { name: `Menu ${stamp}`, slug: `menu${stamp}` } });
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  const imported = await page.request.post(`/projects/${projectId}/import`, {
    data: {
      pages: [
        { id: 'home', path: '', title: 'Home', source: '<p>home</p>' },
        ...Array.from({ length: PAGES }, (_, i) => ({
          id: `p-${String(i).padStart(2, '0')}`,
          path: `p-${String(i).padStart(2, '0')}`,
          parent: 'home',
          order: (i + 1) * 65_536,
          title: `Page ${String(i).padStart(2, '0')}`,
          source: '<p>body</p>',
        })),
      ],
    },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  return { projectId, name: `Menu ${stamp}` };
}

/** The sibling order as the list shows it, read back from the API. */
async function order(page: import('@playwright/test').Page, projectId: string): Promise<string[]> {
  const items = (await (await page.request.get(`/projects/${projectId}/content/page`)).json()).items as Array<{
    id: string;
    order?: number;
  }>;
  return items
    .filter((p) => p.id !== 'home')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((p) => p.id);
}

test('right-click opens the menu with every row action, and Move to reaches both ends of the group', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const { projectId, name } = await seed(page, 'ctxmenu');
  await page.goto(baseURL!);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('li[data-virtual-row]').first()).toBeVisible();

  const row = page.locator('li[data-virtual-row]').filter({ hasText: 'Page 05' }).first();
  await row.click({ button: 'right' });

  const menu = page.getByRole('menu', { name: /Actions for/ });
  await expect(menu).toBeVisible();
  for (const label of ['Open page editor', 'Edit page settings', 'Preview in new tab', 'Duplicate page', 'Move to', 'Delete page']) {
    await expect(menu.getByRole('menuitem', { name: label })).toBeVisible();
  }

  // Move to → Bottom of group: a distance drag cannot cover comfortably.
  await menu.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Bottom of group' }).click();
  await expect.poll(async () => (await order(page, projectId)).at(-1), { timeout: 20_000 }).toBe('p-05');

  // …and back to the top.
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Top of group' }).click();
  await expect.poll(async () => (await order(page, projectId))[0], { timeout: 20_000 }).toBe('p-05');
});

test('★ Duplicate places the copy immediately after its source', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const { projectId, name } = await seed(page, 'ctxdup');
  await page.goto(baseURL!);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('li[data-virtual-row]').first()).toBeVisible();

  await page.locator('li[data-virtual-row]').filter({ hasText: 'Page 03' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate page' }).click();

  await expect
    .poll(async () => {
      const ids = await order(page, projectId);
      const at = ids.indexOf('p-03');
      return at >= 0 ? ids[at + 1] : undefined;
    }, { message: 'the copy should sit directly after its source', timeout: 20_000 })
    .toMatch(/^p-03-/);
});

test('★ Move to → Select sibling… places a page next to one chosen AFTER scrolling and searching', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const { projectId, name } = await seed(page, 'ctxcut');
  await page.goto(baseURL!);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.locator('li[data-virtual-row]').first()).toBeVisible();

  // Pick up the FIRST page…
  await page.locator('li[data-virtual-row]').filter({ hasText: 'Page 00' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Select sibling…' }).click();
  await expect(page.getByRole('status', { name: 'Move in progress' })).toContainText('Moving');

  // ★ …then SEARCH for the destination. This is the whole point: nothing is held, so the list stays
  // usable. A drag cannot do this — filtering mid-drag makes "drop below the row above" meaningless.
  const search = page.getByLabel('Search pages');
  if (await search.count()) await search.fill('Page 10');
  await page.locator('li[data-virtual-row]').filter({ hasText: 'Page 10' }).first().click();

  await expect
    .poll(async () => {
      const ids = await order(page, projectId);
      const at = ids.indexOf('p-10');
      return at >= 0 ? ids[at + 1] : undefined;
    }, { message: 'the picked-up page should land directly after the chosen sibling', timeout: 20_000 })
    .toBe('p-00');
  await expect(page.getByRole('status', { name: 'Move in progress' })).toBeHidden();
});

test('the keyboard opens the same menu and Escape closes it', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const { name } = await seed(page, 'ctxkbd');
  await page.goto(baseURL!);
  await page.getByText(name, { exact: true }).first().click();
  const row = page.locator('li[data-virtual-row]').filter({ hasText: 'Page 02' }).first();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /^Settings for/ }).focus();
  await page.keyboard.press('Shift+F10');

  const menu = page.getByRole('menu', { name: /Actions for/ });
  await expect(menu).toBeVisible();
  // Opens focused so the very next keystroke acts on it.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test.describe('touch', () => {
  // Only the touch-relevant fixtures: a full `devices[…]` preset also sets defaultBrowserType, which
  // Playwright refuses inside a describe (it would force a new worker).
  test.use({ hasTouch: true, viewport: { width: 412, height: 915 } });

  test('★ long-press opens the menu, and a scroll does NOT', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const { name } = await seed(page, 'ctxtouch');
    await page.goto(baseURL!);
    await page.getByText(name, { exact: true }).first().click();
    const row = page.locator('li[data-virtual-row]').filter({ hasText: 'Page 04' }).first();
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    const menu = page.getByRole('menu', { name: /Actions for/ });

    // A SCROLL starts exactly like a press — a finger down on a row. It must not open the menu.
    await page.touchscreen.tap(box.x + 30, box.y + box.height / 2); // wake the surface
    await page.evaluate(() => {
      const el = document.querySelector('li[data-virtual-row]')!;
      // Chromium's TouchEvent requires real Touch instances, not object literals.
      const at = (x: number, y: number) => [new Touch({ identifier: 0, target: el, clientX: x, clientY: y })];
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: at(30, 300) }));
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: at(30, 240) }));
    });
    await page.waitForTimeout(900);
    await expect(menu, 'a scroll must not open the menu').toBeHidden();

    // A HELD finger does.
    await page.evaluate(() => {
      const el = document.querySelectorAll('li[data-virtual-row]')[4]!;
      const at = (x: number, y: number) => [new Touch({ identifier: 0, target: el, clientX: x, clientY: y })];
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: at(40, 320) }));
    });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // Tapping away dismisses it.
    await page.touchscreen.tap(10, 10);
    await expect(menu).toBeHidden();
  });
});
