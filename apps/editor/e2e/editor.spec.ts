import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('build a nested page with live preview, save, and reload', async ({ page }) => {
  await page.goto('/');

  // Register a new agency account.
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Agency ${stamp}`);
  await page.getByLabel('Email').fill(`editor-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Dashboard → create a project.
  await expect(page.getByRole('heading', { name: /Projects/ })).toBeVisible();
  await page.getByLabel('Project name').fill('Client Site');
  await page.getByLabel('Project slug').fill(`client-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the project and add a page.
  await page.getByRole('button', { name: /Client Site/ }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  // Visual editor: nest a Heading inside a Grid (root Section is selected by default).
  await page.getByRole('button', { name: '+ Grid', exact: true }).click();
  await page.getByRole('button', { name: '+ Heading', exact: true }).click();
  await page.getByLabel('Text').fill('Welcome');

  // The live SSR preview reflects the edit.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.locator('body')).toContainText('Welcome');

  // Save and return to the project page list.
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();

  // Reopen the page — the nested block persisted.
  await page.getByRole('button', { name: /Home Page/ }).click();
  const previewReloaded = page.frameLocator('iframe[title="Live preview"]');
  await expect(previewReloaded.locator('body')).toContainText('Welcome');
});
