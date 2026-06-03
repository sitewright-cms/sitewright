import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A code page is a first-class page: its "Page settings" panel sets status + nav placement.
// Set draft + header nav, save, and confirm it persists across reopen.

test('code page settings: set draft + nav placement, persisted across reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`cset-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Code Settings Site');
  await page.getByLabel('Project slug').fill(`cset-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Code Settings Site/ }).click();

  // Create a code page and open it.
  await page.getByLabel('Page slug').fill('about');
  await page.getByLabel('Page title').fill('About');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /About/ }).click();

  // Page settings → draft + header nav + order.
  await page.getByRole('button', { name: 'Page settings' }).click();
  await page.getByRole('button', { name: 'draft', exact: true }).click();
  await page.getByLabel('Nav: header').check();
  await page.getByLabel('Nav order').fill('2');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  // Back to the project list shows the draft badge.
  await page.getByRole('button', { name: 'Back to pages' }).click();
  await expect(page.getByText('draft')).toBeVisible();

  // Reopen → the settings persisted.
  await page.getByRole('button', { name: /About/ }).click();
  await page.getByRole('button', { name: 'Page settings' }).click();
  await expect(page.getByRole('button', { name: 'draft', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Nav: header')).toBeChecked();
  await expect(page.getByLabel('Nav order')).toHaveValue('2');
});
