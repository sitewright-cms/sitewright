import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

const stamp = Date.now();
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * "Search for unused files" — the File Manager's find-and-delete flow, driven in a real browser.
 *
 * The unit tests cover the modal's logic against a mocked API and the scan against a real database.
 * What only a browser can prove is the part that matters most before anyone trusts select-all: that
 * the scan sees a reference in a page an author actually wrote, so the file on the page is NOT
 * offered for deletion while the one nobody used IS.
 */
test('unused files: finds only what nothing references, and deletes to the Recycle Bin', async ({ page }) => {
  await signUp(page, `unused-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Unused Files');
  await page.getByLabel('Project slug').fill(`unused-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Upload the file that WILL be referenced, on its own — with a single media image on screen its
  // delivery URL can be read straight off the DOM. (The clipboard route needs a permission this
  // suite does not grant, and the URL is what matters, not how it was copied.)
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  await page.getByLabel('Upload files').setInputFiles({ name: 'on-the-page.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('button', { name: 'on-the-page.png', exact: true })).toBeVisible();

  const src = await page.locator('img[src*="/media/"]').first().getAttribute('src');
  expect(src).toBeTruthy();
  const url = (src as string).split('?')[0]; // drop any on-demand thumbnail query
  expect(url).toContain('/media/');

  // Reference it from the home page, the way an author would — the URL carries the asset id, which
  // is what the scan matches on.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('hero');
  await page.getByLabel('Page title').fill('Hero');
  await page.getByRole('button', { name: 'Create page' }).click();
  await page.getByRole('button', { name: /^Hero/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(`<section><img src="${url}" alt="hero"></section>`);
  // `exact` avoids the pages-list "Save … as template" buttons.
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Now a second file that nothing will ever point at.
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  await page.getByLabel('Upload files').setInputFiles({ name: 'nobody-wants-me.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('button', { name: 'nobody-wants-me.png', exact: true })).toBeVisible();

  // Now scan.
  await page.getByRole('button', { name: 'Search for unused files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unused files' });
  await expect(dialog).toBeVisible();

  // The body carries its own inset — Modal supplies the panel, not the padding, so a body rendered
  // straight into it sits flush against the panel edge. Measure the GAP between the panel edge and
  // the first content element: a class-name check is not an inset (a `[class*="p-"]` probe matched
  // `py-2` on an inner row and passed against the unpadded build).
  const inset = await dialog.evaluate((d) => {
    const scroller = d.lastElementChild as HTMLElement; // Modal: header, then the body scroller
    const body = scroller?.firstElementChild as HTMLElement | undefined;
    // The wrapper's OWN padding, not its left edge: the wrapper is full-width and starts at the
    // panel edge either way, so its position says nothing (measuring that read 1px on both builds).
    return body ? parseFloat(getComputedStyle(body).paddingLeft) : 0;
  });
  expect(inset).toBeGreaterThan(8);

  // ★ The whole point: the referenced file is absent, the unreferenced one is present and PRE-TICKED.
  await expect(dialog.getByText('nobody-wants-me.png')).toBeVisible();
  await expect(dialog.getByText('on-the-page.png')).toHaveCount(0);
  await expect(dialog.getByLabel('Select nobody-wants-me.png')).toBeChecked();

  // The modal states its own reach rather than asking to be trusted.
  await expect(dialog.getByText(/Searched \d+ content record/)).toBeVisible();

  await dialog.getByRole('button', { name: /Move 1 to Recycle Bin/ }).click();
  await page.getByRole('button', { name: 'Move to Recycle Bin' }).click();
  await expect(dialog).toHaveCount(0);

  // Gone from the library…
  await expect(page.getByRole('button', { name: 'nobody-wants-me.png', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'on-the-page.png', exact: true })).toBeVisible();

  // …and RECOVERABLE, which is what makes select-all-by-default a defensible default.
  await page.getByRole('button', { name: 'Recycle Bin' }).click();
  await expect(page.getByText('nobody-wants-me.png')).toBeVisible();
});

test('unused files: says so plainly when everything is referenced', async ({ page }) => {
  await signUp(page, `unused-none-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('All Used');
  await page.getByLabel('Project slug').fill(`allused-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // No uploads at all — the empty case an author meets on a tidy project.
  await page.getByRole('button', { name: 'Open File Manager' }).click();
  await page.getByRole('button', { name: 'Search for unused files' }).click();
  const dialog = page.getByRole('dialog', { name: 'Unused files' });
  await expect(dialog.getByText(/Nothing unused/)).toBeVisible();
});
