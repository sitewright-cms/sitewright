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

  // The permanent Library handle is on the right edge; open it.
  await page.getByRole('button', { name: 'Open library' }).click();
  await expect(page.getByText('Ripple effect')).toBeVisible();

  // Search narrows to ripple; open the item → details modal with the example.
  await page.getByLabel('Search library').fill('ripple');
  await expect(page.getByText('DaisyUI components')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ripple on a primary button' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ripple on a primary button' });
  await expect(dialog.getByText(/waves-effect waves-light/)).toBeVisible();
  // The Copy button is present (clipboard write itself needs a secure context, so the
  // copy result is covered by the unit test, not here).
  await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
  await page.keyboard.press('Escape'); // close the detail modal

  // Author a page that uses BOTH a data-bg lazyload background and a waves-effect CTA,
  // then publish and assert both runtimes shipped.
  await page.getByLabel('Page path').fill('/launch');
  await page.getByLabel('Page title').fill('Launch');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /^Launch/ }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('<section data-bg="/media/x.jpg" class="h-64"><a class="btn btn-primary waves-effect waves-light" href="/">Go</a></section>');
  await page.getByRole('button', { name: 'Save' }).click();
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
  void context;
});
