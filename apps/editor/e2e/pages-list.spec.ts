import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The pages list: every project starts with an undeletable HOME page; rows carry
// per-page actions (preview in a new tab, open editor, settings, copy, delete);
// settings from the list persist directly; templates lock the page's code editor.

test('pages list: auto-home, row actions, list settings, template lock + fork', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`plist-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('List Site');
  await page.getByLabel('Project slug').fill(`plist-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // A fresh project already has its HOME page (auto-created, path "/") — and home
  // is permanent: every page gets a Delete action EXCEPT home.
  await expect(page.getByRole('button', { name: /^Home \// })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Home' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy Home' })).toBeVisible();

  // Create a sub-page by PATH.
  await page.getByRole('button', { name: 'New page' }).click();
  await page.getByLabel('Page path').fill('services');
  await page.getByLabel('Page title').fill('Services');
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(page.getByRole('button', { name: /^Services/ })).toBeVisible();

  // COPY → a "(Copy)" row appears under a suffixed path; DELETE it (confirm) → gone.
  await page.getByRole('button', { name: 'Copy Services' }).click();
  const copyRow = page.getByRole('button', { name: /^Services \(Copy\)/ });
  await expect(copyRow).toBeVisible();
  await expect(copyRow).toContainText(/\/services-[a-z0-9]+/); // short random path suffix
  await page.getByRole('button', { name: 'Delete Services (Copy)' }).click();
  await page.getByRole('dialog', { name: 'Delete page' }).getByRole('button', { name: 'Delete' }).click();
  await expect(copyRow).toHaveCount(0);

  // SETTINGS from the list (no editor): meta description + a GLOBAL template; persists directly.
  await page.getByRole('button', { name: 'Settings for Services' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Meta description').fill('All our services, explained.');
  await page.getByLabel('Page template').selectOption('global:text');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The row now shows the template badge; reopening settings shows the saved values.
  await expect(page.getByRole('button', { name: /^Services/ })).toContainText('template');
  await page.getByRole('button', { name: 'Settings for Services' }).click();
  await expect(page.getByLabel('Meta description')).toHaveValue('All our services, explained.');
  await expect(page.getByLabel('Page template')).toHaveValue('global:text');
  await page.keyboard.press('Escape');

  // The template LOCKS the page's code surface; content mode edits its regions;
  // forking copies the source into the page and unlocks the editor.
  await page.getByRole('button', { name: 'Edit Services' }).click();
  await expect(page.getByText(/renders the template/)).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0); // no code editor while referenced
  // The template renders its content in the preview (global:text's editable heading region).
  await expect(page.frameLocator('iframe[title="Preview"]').getByText('Page heading')).toBeVisible();
  await page.getByRole('button', { name: 'Fork template into page' }).click();
  await expect(page.locator('.cm-content')).toContainText('data-sw-text="heading"'); // unlocked, source copied
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.keyboard.press('Escape');

  // PREVIEW opens the sandboxed draft document in a NEW TAB.
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Preview Home' }).click();
  const popup = await popupPromise;
  await popup.waitForURL(/\/preview\//);
  await expect(popup.locator('h1')).toContainText('List Site'); // {{ company.name }} bound
});
