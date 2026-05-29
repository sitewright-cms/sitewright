import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('define a dataset, add an entry, bind a list to it, and see it in the preview', async ({
  page,
}) => {
  await page.goto('/');

  // Register + create a project.
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Data Agency ${stamp}`);
  await page.getByLabel('Email').fill(`data-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Data Site');
  await page.getByLabel('Project slug').fill(`data-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Data Site/ }).click();

  // --- Data tab: create a "Posts" dataset with a "title" field ---
  await page.getByRole('button', { name: 'data', exact: true }).click();
  await page.getByLabel('Dataset name').fill('Posts');
  await page.getByRole('button', { name: 'Create dataset' }).click();

  await page.getByLabel('New field name').fill('title');
  await page.getByRole('button', { name: 'Add field' }).click();
  await page.getByRole('button', { name: 'Save schema' }).click();

  // Add a published-or-draft entry (preview shows drafts).
  await page.getByRole('button', { name: 'New entry' }).click();
  await page.getByLabel('title', { exact: true }).fill('Hello World');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('button', { name: 'Hello World' })).toBeVisible();

  // --- Pages tab: create a page and open it ---
  await page.getByRole('button', { name: 'pages', exact: true }).click();
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();

  // --- Bind a Grid (list) to the dataset, with a Heading bound to the title field ---
  await page.getByRole('button', { name: '+ Grid', exact: true }).click();
  await page.getByLabel('Bind to dataset').selectOption('posts');
  await page.getByLabel('Binding mode').selectOption('list');

  await page.getByRole('button', { name: '+ Heading', exact: true }).click();
  await page.getByLabel('Bind Text').selectOption('title');

  // The list binding renders the entry's title in the live preview.
  const preview = page.frameLocator('iframe[title="Live preview"]');
  await expect(preview.locator('body')).toContainText('Hello World');
});
