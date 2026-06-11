import { test, expect } from '@playwright/test';

const stamp = Date.now();

// OIDC admin config → login button. Runs as admin@e2e.test (SW_ADMIN_EMAILS on the test container).
// A full IdP round-trip needs an external provider, so this covers the configurable surface: an admin
// adds a provider in System Settings, and the login screen then offers it. (The protocol/provisioning
// is covered by the API unit + mock-IdP tests.)
test('admin configures an OIDC provider; the login screen offers it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill('admin@e2e.test');
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  const exists = await page.getByText('email already registered').waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false);
  if (exists) {
    await page.getByRole('button', { name: 'Have an account? Sign in' }).click();
    await page.getByLabel('Email').fill('admin@e2e.test');
    await page.getByLabel('Password').fill('pw-secret-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('SSO Co');
  await page.getByLabel('Project slug').fill(`sso-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();

  const modal = page.getByRole('dialog', { name: 'System settings' });
  await modal.getByRole('button', { name: 'Add provider' }).click();
  await modal.getByLabel('Provider 1 id').fill('e2esso');
  await modal.getByLabel('Provider 1 label').fill('E2E SSO');
  await modal.getByLabel('Provider 1 issuer').fill('https://idp.e2e.test');
  await modal.getByLabel('Provider 1 client id').fill('e2e-client');
  await modal.getByLabel('Provider 1 client secret').fill('e2e-secret');
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();

  // Sign out → the login screen now shows the provider button pointing at the start route.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const ssoLink = page.getByRole('link', { name: 'Sign in with E2E SSO' });
  await expect(ssoLink).toBeVisible();
  await expect(ssoLink).toHaveAttribute('href', /\/auth\/oidc\/e2esso\/start$/);
});
