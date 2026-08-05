import { test, expect } from '@playwright/test';
import { deployLocally, fetchLiveSite, signUp } from './helpers.js';

const stamp = Date.now();

// The Library reference panel + the lazyload/ripple runtimes shipping on publish.

test('library panel: open, search, and copy an example; lazyload + ripple publish', async ({ page, context }) => {
  await signUp(page, `lib-${stamp}@e2e.test`);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Library Site');
  await page.getByLabel('Project slug').fill(`lib-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author a page that uses BOTH a data-bg lazyload background and a waves-effect CTA,
  // then publish and assert both runtimes shipped. (Done first, with the Library rail
  // collapsed, so it can't overlay the add-page form.)
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('launch');
  await page.getByLabel('Page title').fill('Launch');
  await page.getByRole('button', { name: 'Create page' }).click();
  await page.getByRole('button', { name: /^Launch/ }).click();
  await page.getByRole('button', { name: 'Code Editor', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<section data-bg="/media/x.jpg" class="h-64"><a class="btn btn-primary waves-effect waves-light" href="/">Go</a></section>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Deploy to Local Hosting via the header, then fetch the live page over HTTP.
  await deployLocally(page);
  const launch = await fetchLiveSite(page, `lib-${stamp}`, '/launch/');
  expect(launch.status).toBe(200);
  const body = launch.html;
  expect(body).toContain('data-bg="/media/x.jpg"');
  expect(body).toContain('waves-effect waves-light');
  // Match the src WITHOUT pinning the cache-busting `?v=<hash>` published assets carry — an exact-string
  // assertion here would break every time that hash scheme legitimately changes.
  expect(body).toMatch(/<script defer src="\.\.\/lazyload\.js(\?v=[^"]*)?"><\/script>/);
  expect(body).toMatch(/<script defer src="\.\.\/ripple\.js(\?v=[^"]*)?"><\/script>/);

  // The Library is a LEFT hover side-panel; hovering its edge tab expands the fixed-size panel to
  // reveal the section buttons. Each section title opens a searchable gallery modal (which pins the
  // panel open for its lifetime). The helper only re-hovers the tab when the panel has collapsed.
  const library = page.locator('[role="region"][aria-label="System Library"]');
  const openSection = async (name: RegExp) => {
    if ((await library.getAttribute('aria-hidden')) === 'true') {
      await page.getByRole('button', { name: 'Open System Library' }).click();
      await expect(library).toHaveAttribute('aria-hidden', 'false');
    }
    await library.getByRole('button', { name }).click();
  };

  // Ripple (and the other directive-only effects) now live as tabs inside the SiteWright Components
  // reference — searchable + copyable there.
  await openSection(/SiteWright Components/);
  const sw = page.getByRole('dialog', { name: 'SiteWright Components' });
  await sw.getByLabel('Search SiteWright Components').fill('ripple');
  await expect(sw.getByText('Ripple on a primary button')).toBeVisible();
  await expect(sw.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Icons, brand logos & country flags now share ONE tabbed gallery ("Icons & flags").
  await openSection(/Icons & flags/);
  const iconsGallery = page.getByRole('dialog', { name: 'Icons & flags' });
  // Icons tab (default): the whole Phosphor pack, searchable by name.
  await iconsGallery.getByLabel('Search icons').fill('rocket');
  await expect(iconsGallery.getByRole('button', { name: 'Copy rocket icon snippet' })).toBeVisible();
  // Brand tab: brand: prefix snippets.
  await iconsGallery.getByRole('tab', { name: 'Brand' }).click();
  await expect(iconsGallery.getByRole('button', { name: 'Copy GitHub icon snippet' })).toBeVisible();
  await page.keyboard.press('Escape');

  // DaisyUI components render a live preview inside the modal.
  await openSection(/DaisyUI components/);
  const daisy = page.getByRole('dialog', { name: 'DaisyUI components' });
  await daisy.getByLabel('Search DaisyUI components').fill('button');
  await expect(daisy.locator('.sw-preview .btn').first()).toBeVisible();
  await page.keyboard.press('Escape');
  void context;
});
