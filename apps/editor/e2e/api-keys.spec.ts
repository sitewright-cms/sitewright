import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Project settings → API keys: create a PAT (token shown once), see it listed,
// then revoke it — all from the editor UI.
test('create, view, and revoke a project API key from the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(`keys-ui-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('button', { name: 'New project' }).click();

  await page.getByLabel('Project name').fill('Keyed Site');
  await page.getByLabel('Project slug').fill(`keyed-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();

  // Create a key.
  await page.getByLabel('API key name').fill('CI deploy');
  await page.getByRole('button', { name: 'Create key' }).click();

  // The raw token is shown exactly once.
  const tokenBox = page.getByLabel('New API token');
  await expect(tokenBox).toBeVisible();
  await expect(tokenBox).toContainText(/^swk_/);

  // …and the key now appears in the list.
  await expect(page.getByText('CI deploy')).toBeVisible();

  // Revoke it → confirm in the modal dialog → it disappears from the list.
  await page.getByRole('button', { name: 'Revoke CI deploy' }).click();
  await page.getByRole('dialog', { name: 'Revoke API key' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('button', { name: 'Revoke CI deploy' })).toHaveCount(0);
  await expect(page.getByText('No API keys yet.', { exact: false })).toBeVisible();
});
