import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The dataset manager (CMS): define a dataset + schema and add an entry. Code-first pages
// consume datasets via `{{#each data.<set>}}` in the template source (no block-binding UI).
test('define a dataset, its schema, and add an entry', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`data-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Data Site/ }).click();

  // Data tab: create a "Posts" dataset with a "title" field.
  await page.getByRole('button', { name: 'data', exact: true }).click();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();
  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add an entry; it appears in the entry list.
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello World');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('button', { name: 'Hello World' })).toBeVisible();
});
