import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Inserts a built-in Starter library snippet into a page and verifies it renders
// (forked into the page) in the live preview.

test('insert a Starter library snippet → renders in the page preview', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Snippets Agency ${stamp}`);
  await page.getByLabel('Email').fill(`snippets-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Snippet Site');
  await page.getByLabel('Project slug').fill(`snip-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Snippet Site/ }).click();

  // Create and open a page.
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home/ }).click();

  // The Starter library is present; insert the "Call to action" snippet.
  await expect(page.getByRole('heading', { name: 'Starter library' })).toBeVisible();
  await page.getByRole('button', { name: 'Call to action', exact: true }).click();

  // The forked snippet renders in the live preview.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.getByText('Ready to get started?')).toBeVisible();
});
