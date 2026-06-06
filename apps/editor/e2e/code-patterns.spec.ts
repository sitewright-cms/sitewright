import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Insert a built-in DaisyUI starter pattern into a code page and verify it renders in the
// live preview (brand-themed via the DaisyUI integration) and persists on save.

test('insert a DaisyUI starter pattern into a code page → renders in the preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`patterns-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Pattern Site');
  await page.getByLabel('Project slug').fill(`pat-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the auto-created home page (the empty-slug root).
  await page.getByRole('button', { name: /^Home/ }).click();

  // Insert the Hero pattern; its source lands in the editor…
  await page.getByLabel('Insert pattern').selectOption('hero');
  await expect(page.locator('.cm-content')).toContainText('{{edit "hero_title"');

  // …and the live preview renders the DaisyUI hero (the {{edit}} default text).
  const preview = page.frameLocator('iframe[title="Preview"]');
  await expect(preview.getByRole('heading', { name: 'Build something people love' })).toBeVisible();

  // Save persists it. (`exact` avoids the pages-list "Save … as template" buttons.)
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});
