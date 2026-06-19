import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Live verification of the PR3 import wizard: register → "From website" → create a project →
// crawl example.com → see the report → open the imported project. Exercises real-browser SSE.
test('import wizard: From website → crawl example.com → report → open project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`import-${stamp}@e2e.test`);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // The project selector opens after sign-in; start the from-website flow.
  await page.getByRole('button', { name: 'From website' }).click();
  await page.getByLabel('Project name').fill(`Import E2E ${stamp}`); // unique slug across re-runs (persistent slot DB)
  await page.getByRole('button', { name: 'Create project' }).click();

  // The wizard opens. Enter a URL and start the crawl.
  await page.getByLabel('Website URL').fill('https://example.com');
  await page.getByRole('button', { name: 'Start import' }).click();

  // The report step appears with an Open-project CTA.
  await expect(page.getByRole('button', { name: 'Open project' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Imported \d+ page/)).toBeVisible();

  // Opening the project shows the imported home page (title from example.com's <title>).
  await page.getByRole('button', { name: 'Open project' }).click();
  await expect(page.getByText('Example Domain').first()).toBeVisible({ timeout: 20_000 });
});
