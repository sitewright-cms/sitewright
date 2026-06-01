import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A developer marks a block as client-editable in the full editor; the flag persists
// across a save + reopen (the server-side enforcement of who may edit it is covered
// by the API tests).

test('developer marks a block editable-by-client; the flag persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Organization name').fill(`Editable Agency ${stamp}`);
  await page.getByLabel('Email').fill(`editable-${stamp}@e2e.test`);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Project name').fill('Editable Site');
  await page.getByLabel('Project slug').fill(`edit-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: /Editable Site/ }).click();

  await page.getByLabel('Page slug').fill('home');
  await page.getByLabel('Page title').fill('Home');
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.getByRole('button', { name: /Home/ }).click();

  // Add a RichText block and select it, then mark it client-editable.
  await page.getByRole('button', { name: '+ Rich text', exact: true }).click();
  await page.getByLabel('Editable by client').check();
  await page.getByRole('button', { name: 'Save page' }).click();

  // Reopen the page → the editable flag is still set on that block.
  await page.getByRole('button', { name: 'Back to project' }).click();
  await page.getByRole('button', { name: /Home/ }).click();
  // Select the RichText block in the outline, then assert its toggle is checked.
  await page.getByText('Rich text', { exact: true }).first().click();
  await expect(page.getByLabel('Editable by client')).toBeChecked();
});
