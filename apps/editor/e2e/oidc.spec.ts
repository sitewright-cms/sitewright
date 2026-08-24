import { test, expect } from '@playwright/test';
import { dismissProjectSelector, signInAsAdmin } from './helpers.js';

const stamp = Date.now();

// OIDC admin config → login button. Runs as admin@e2e.test (SW_ADMIN_EMAILS on the test container).
// A full IdP round-trip needs an external provider, so this covers the configurable surface: an admin
// adds a provider in System Settings, and the login screen then offers it. (The protocol/provisioning
// is covered by the API unit + mock-IdP tests.)
test('admin configures an OIDC provider; the login screen offers it', async ({ page }) => {
  await signInAsAdmin(page);

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('SSO Co');
  await page.getByLabel('Project slug').fill(`sso-${stamp}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();

  const modal = page.getByRole('dialog', { name: 'System settings' });
  // Single sign-on (OIDC) sits under "Integrations" — an identity provider belongs with the other
  // third-party wiring (SMTP, captcha, AI keys), not with Ops (backups, logging, database health).
  await modal.getByRole('tab', { name: 'Integrations' }).click();
  // Providers are INSTANCE-GLOBAL: start from none so a re-run against the same slot doesn't edit
  // "Provider 2" and assert against a stale "Provider 1".
  // (Removing provider 1 renumbers the rest, so the same locator drains the list; the bound keeps a
  // misbehaving remove button from spinning here instead of failing.)
  const firstRemove = modal.getByRole('button', { name: 'Remove provider 1' });
  for (let i = 0; i < 10 && (await firstRemove.count()); i++) await firstRemove.click();
  await expect(firstRemove).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  const ssoLink = page.getByRole('link', { name: 'Sign in with E2E SSO' });
  await expect(ssoLink).toBeVisible();
  await expect(ssoLink).toHaveAttribute('href', /\/auth\/oidc\/e2esso\/start$/);

  // Put the instance back: a configured provider is GLOBAL, and it changes screens other specs drive
  // (the login form grows a provider button; the invite landing switches to its "choose how to
  // continue" screen). Leaving it behind makes those specs pass or fail depending on run ORDER.
  await signInAsAdmin(page);
  await dismissProjectSelector(page); // a fresh load with no project open covers the header gear
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'System Settings' }).click();
  await modal.getByRole('tab', { name: 'Integrations' }).click();
  await modal.getByRole('button', { name: 'Remove provider 1' }).click();
  await modal.getByRole('button', { name: 'Save settings' }).click();
  await expect(modal.getByText('Saved.')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Remove provider 1' })).toHaveCount(0);
});
