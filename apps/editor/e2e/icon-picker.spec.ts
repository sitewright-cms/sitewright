import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();

/**
 * THE ICON PICKER'S GRID MUST REACH THE WHOLE SET.
 *
 * ★★ It did not, and nothing here was watching: the picker had no E2E coverage at all. Every tab
 * ended its list in `.slice(0, PAGE)` with no mechanism anywhere to raise it, so the grid showed the
 * first 120 matches and scrolling simply ran out — hiding 1393 of 1513 Phosphor icons, 155 of 275
 * brands, and 135 of 255 flags. Silently: no count, no "load more", nothing that said the set
 * continued, so it read as "that is all there is".
 *
 * The regression this guards is therefore not "paging is broken" but "paging exists at all", which
 * is why the assertions are about REACHING THE END rather than about any particular page size.
 */

/** Opens the picker from a social-profile row, which is the shortest path to it. */
async function openPicker(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await page.getByRole('button', { name: '+ Add profile' }).click();
  await page.getByRole('button', { name: 'Pick an icon for profile 1' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose an icon' });
  await expect(picker.getByRole('button', { name: 'Icons', exact: true })).toBeVisible();
  return picker;
}

test('icon picker: the grid pages past the first screenful, by scroll and by button', async ({ page }) => {
  await signUp(page, `iconpick-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Icon Site');
  await page.getByLabel('Project slug').fill(`iconpick-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  const picker = await openPicker(page);
  const tiles = picker.locator('[data-sw-icon-tile]');

  // The set size is STATED — the silent truncation is the half of the bug a user cannot see.
  await expect(picker.getByText(/Showing \d+ of \d+/)).toBeVisible();
  const firstPage = await tiles.count();
  expect(firstPage).toBeGreaterThan(50);

  // ★ Clicking the sentinel loads more. It is a real button so a keyboard user is not stranded in a
  // scroll container they cannot reach.
  await picker.getByRole('button', { name: /Load more/ }).click();
  await expect.poll(() => tiles.count()).toBeGreaterThan(firstPage);

  // ★★ And SCROLLING loads more — the observer is rooted on the grid, not the viewport. Rooted on
  // the viewport it arms cleanly and never fires, because the grid clips the sentinel.
  const afterClick = await tiles.count();
  const grid = picker.locator('[data-sw-icon-grid]');
  await grid.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(() => tiles.count(), { timeout: 10_000 }).toBeGreaterThan(afterClick);
});

test('icon picker: every flag is reachable — the set ends, and says so', async ({ page }) => {
  await signUp(page, `iconflag-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Flag Site');
  await page.getByLabel('Project slug').fill(`iconflag-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  const picker = await openPicker(page);
  await picker.getByRole('button', { name: 'Flags', exact: true }).click();
  const tiles = picker.locator('[data-sw-icon-tile]');
  const grid = picker.locator('[data-sw-icon-grid]');

  // ★ Flags were the worst case: ~255 of them, 120 shown, so roughly half the world's flags could
  // not be browsed to at all. Scroll to the end the way a person does — deliberately NOT by clicking
  // "Load more" in a loop, because the observer removes that button as soon as it has fired, so the
  // click races its own effect and detaches mid-action.
  for (let i = 0; i < 12; i += 1) {
    if (!(await picker.getByRole('button', { name: /Load more/ }).count())) break;
    await grid.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(250);
  }
  await expect(picker.getByRole('button', { name: /Load more/ })).toHaveCount(0);
  // The footer flips from "Showing N of M" to the plain total once everything is rendered.
  await expect(picker.getByText(/^\d+ icons$/)).toBeVisible();
  expect(await tiles.count()).toBeGreaterThan(200);
});

test('icon picker: a new search starts again at the first page', async ({ page }) => {
  await signUp(page, `iconsearch-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Search Site');
  await page.getByLabel('Project slug').fill(`iconsearch-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  const picker = await openPicker(page);
  await picker.getByRole('button', { name: /Load more/ }).click();
  const grown = await picker.locator('[data-sw-icon-tile]').count();

  // ★ A narrowed question must not inherit the previous answer's scroll length.
  await picker.getByLabel('Search icons').fill('wifi');
  await expect.poll(() => picker.locator('[data-sw-icon-tile]').count()).toBeLessThan(grown);
  await expect(picker.getByText('Nothing matched')).toHaveCount(0);
});

test('icon picker: every weight draws differently — Regular is reachable', async ({ page }) => {
  await signUp(page, `iconwt-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Weight Site');
  await page.getByLabel('Project slug').fill(`iconwt-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  const picker = await openPicker(page);
  await picker.getByLabel('Search icons').fill('acorn');
  const art = () => picker.locator('[data-sw-icon-tile]').first().locator('span').first().innerHTML();

  // ★★ `regular` used to be emitted as a BARE name, and a bare name renders FILL — so picking
  // Regular silently handed back a fill icon, byte-identical to the Fill tab. Six weights, six
  // different drawings, or the control is lying about what it just gave you.
  const seen = new Set<string>();
  for (const w of ['thin', 'light', 'regular', 'bold', 'fill', 'duotone']) {
    await picker.getByRole('radio', { name: w }).click();
    await expect.poll(async () => (await art()).length).toBeGreaterThan(0);
    seen.add(await art());
  }
  expect(seen.size).toBe(6);
});
