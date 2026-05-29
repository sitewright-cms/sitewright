import { test, expect } from '@playwright/test';

const stamp = Date.now();

test('build a page, publish the project, and view the live site', async ({ page, baseURL }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Publish Agency ${stamp}`);
  await page.getByLabel('Email').fill(`publish-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Live Site');
  await page.getByLabel('Project slug').fill(`live-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Live Site/ }).click();

  // Build a home page with a heading.
  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home Page');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home Page/ }).click();
  await page.getByRole('button', { name: '+ Heading', exact: true }).click();
  await page.getByLabel('Text').fill('We Are Live');
  await page.getByRole('button', { name: 'Save page' }).click();

  // Publish, then visit the live site link.
  await page.getByRole('button', { name: 'Publish' }).click();
  const viewLink = page.getByRole('link', { name: 'View published site' });
  await expect(viewLink).toBeVisible();

  const href = await viewLink.getAttribute('href');
  expect(href).toMatch(/^\/sites\/[\w-]+\/$/);

  // The published static page renders the content.
  await page.goto(`${baseURL}${href}`);
  await expect(page.locator('body')).toContainText('We Are Live');
});
