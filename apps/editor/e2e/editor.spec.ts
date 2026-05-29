import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('register → create project → add a page (full UI flow)', async ({ page }) => {
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

  // Open the project.
  await page.getByRole('button', { name: /Client Site/ }).click();

  // Add a page.
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();

  // Open the page editor and add a block.
  await page.getByRole('button', { name: /Home Page/ }).click();
  await page.getByRole('button', { name: '+ Heading' }).click();
  await page.getByLabel('Heading text').fill('Welcome');
  await page.getByRole('button', { name: 'Save page' }).click();

  // Back at the project page list.
  await expect(page.getByRole('button', { name: /Home Page/ })).toBeVisible();
});
