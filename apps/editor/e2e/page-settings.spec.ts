import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Drives the PageEditor "Page settings" panel: set a page to draft + place it in the
// header nav, save, and confirm it persists (draft badge in the list + reopened state).

test('set page status + nav placement via Page settings, persisted across reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Pages Agency ${stamp}`);
  await page.getByLabel('Email').fill(`pages-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Pages Site');
  await page.getByLabel('Project slug').fill(`pages-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Pages Site/ }).click();

  // Create an "About" page.
  await page.getByLabel('Page slug').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Add page' }).click();

  // Open it → Page settings → draft + header nav.
  await page.getByRole('button', { name: /About/ }).click();
  await page.getByRole('button', { name: 'Page settings' }).click();
  await page.getByRole('button', { name: 'draft', exact: true }).click();
  await page.getByLabel('Nav: header').check();
  await page.getByLabel('Nav order').fill('2');
  await page.getByRole('button', { name: 'Save page' }).click();

  // Return to the project; the page list shows the draft badge.
  await page.getByRole('button', { name: 'Back to project' }).click();
  await expect(page.getByText('draft')).toBeVisible();

  // Reopen → settings persisted.
  await page.getByRole('button', { name: /About/ }).click();
  await page.getByRole('button', { name: 'Page settings' }).click();
  await expect(page.getByRole('button', { name: 'draft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Nav: header')).toBeChecked();
  await expect(page.getByLabel('Nav order')).toHaveValue('2');
});
