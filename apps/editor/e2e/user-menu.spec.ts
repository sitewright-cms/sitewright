import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The header user/account menu (person icon, right of the settings gear): change password and
// re-login with the new one; confirm Access keys now live here too.
test('user menu: mint an access key, change password, and re-login', async ({ page }) => {
  const email = `user-menu-${stamp}@e2e.test`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // A project makes the Access keys tab active (keys are project-scoped, owner-only).
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Menu Co');
  await page.getByLabel('Project slug').fill(`menu-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open the account menu; the Account tab shows the current login email.
  await page.getByRole('button', { name: 'Account' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });
  await expect(account).toBeVisible();
  await expect(account.getByLabel('Email')).toHaveValue(email);

  // Access keys relocated here — mint one (token shown once).
  await account.getByRole('button', { name: 'Access keys' }).click();
  await account.getByLabel('API key name').fill('CI');
  await account.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByLabel('New API token')).toContainText(/^swk_/);

  // Change the password (re-auth with the current one).
  await account.getByRole('button', { name: 'Password' }).click();
  await account.getByLabel('Current password').fill('Pw-secret-1');
  await account.getByLabel('New password', { exact: true }).fill('New-pw-9876');
  await account.getByLabel('Confirm new password').fill('New-pw-9876');
  await account.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();

  // Close, sign out, then sign back in with the NEW password.
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('New-pw-9876');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Signed back in: the account menu icon is present again.
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});
