import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The Library reference panel + the lazyload/ripple runtimes shipping on publish.

test('library panel: open, search, and copy an example; lazyload + ripple publish', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`lib-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Library Site');
  await page.getByLabel('Project slug').fill(`lib-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Author a page that uses BOTH a data-bg lazyload background and a waves-effect CTA,
  // then publish and assert both runtimes shipped. (Done first, with the Library rail
  // collapsed, so it can't overlay the add-page form.)
  await page.getByLabel('Page path').fill('/launch');
  await page.getByLabel('Page title').fill('Launch');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^Launch/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<section data-bg="/media/x.jpg" class="h-64"><a class="btn btn-primary waves-effect waves-light" href="/">Go</a></section>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Publish via the header, then fetch the live page over HTTP.
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Publish actions' }).click();
  const viewLink = page.getByRole('menuitem', { name: 'View published site' });
  const href = await viewLink.getAttribute('href');
  expect(href).toBeTruthy();

  const launch = await page.request.get(`${new URL(page.url()).origin}${href!.replace(/\/$/, '')}/launch/`);
  const body = await launch.text();
  expect(body).toContain('data-bg="/media/x.jpg"');
  expect(body).toContain('waves-effect waves-light');
  expect(body).toContain('<script defer src="../lazyload.js"></script>');
  expect(body).toContain('<script defer src="../ripple.js"></script>');

  // The Library is a LEFT hover-drawer; the "Open library" toggle expands the rail (also
  // keyboard/touch-accessible) to reveal the section buttons. Each section title opens a
  // searchable gallery modal.
  await page.getByRole('button', { name: 'Open library' }).click();
  await page.getByRole('button', { name: /Ripple effect/ }).click();
  const ripple = page.getByRole('dialog', { name: 'Ripple effect' });
  await expect(ripple.getByText('Ripple on a primary button')).toBeVisible();
  await expect(ripple.getByText(/waves-effect waves-light/)).toBeVisible();
  await expect(ripple.getByRole('button', { name: 'Copy' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // The Icons modal lazy-loads the whole pack and is searchable.
  await page.getByRole('button', { name: /^Icons/ }).click();
  const icons = page.getByRole('dialog', { name: 'Icons' });
  await icons.getByLabel('Search Icons').fill('home');
  await expect(icons.getByRole('button', { name: 'Copy home icon snippet' })).toBeVisible();
  await page.keyboard.press('Escape');

  // DaisyUI components render a live preview inside the modal.
  await page.getByRole('button', { name: /DaisyUI components/ }).click();
  const daisy = page.getByRole('dialog', { name: 'DaisyUI components' });
  await daisy.getByLabel('Search DaisyUI components').fill('button');
  await expect(daisy.locator('.sw-preview .btn').first()).toBeVisible();
  await page.keyboard.press('Escape');
  void context;
});
