import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Drives the glassmorphic Settings editor against the live editor + the unified
// Corporate Identity backend: edit identity + a brand color + website siteUrl,
// save, then reload and confirm everything persisted (full round-trip).

test('edit Corporate Identity + Website settings, save, and persist across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`settings-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Acme Site');
  await page.getByLabel('Project slug').fill(`acme-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Acme Site/ }).click();

  // Open the Corporate Identity top tab → edit identity + a brand color directly.
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();

  await page.getByLabel('Display name').fill('Acme');
  await page.getByLabel('Legal name').fill('Acme Corporation');
  // Add a brand color token.
  await page.getByRole('button', { name: '+ Add color' }).click();
  await page.getByLabel('primary 1', { exact: true }).fill('primary');
  await page.getByLabel('#0ea5e9 1', { exact: true }).fill('#0ea5e9');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Website Settings top tab: set the production URL.
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await page.getByLabel(/Production URL/).fill('https://acme.example');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('✓ Saved')).toBeVisible();

  // Reload → re-open the project → values persisted via the API.
  await page.reload();
  await page.getByRole('button', { name: /Acme Site/ }).click();
  await page.getByRole('tab', { name: 'Corporate Identity' }).click();
  await expect(page.getByLabel('Legal name')).toHaveValue('Acme Corporation');
  await expect(page.getByLabel('primary 1', { exact: true })).toHaveValue('primary');
  await expect(page.getByLabel('#0ea5e9 1', { exact: true })).toHaveValue('#0ea5e9');
  await page.getByRole('tab', { name: 'Website Settings' }).click();
  await expect(page.getByLabel(/Production URL/)).toHaveValue('https://acme.example');
});
