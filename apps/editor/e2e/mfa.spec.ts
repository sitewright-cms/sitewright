import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';

const stamp = Date.now();

// TOTP two-factor end-to-end (needs the deployed instance to have SW_ENCRYPTION_KEY — the slot
// deploy sets one): enrol from the user menu, then sign out and back in through the code step.
test('enrol in TOTP, then sign in through the second-factor step', async ({ page }) => {
  const email = `mfa-${stamp}@e2e.test`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Open the account menu → Security → start enrolment.
  await page.getByRole('button', { name: 'Account' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });
  await account.getByRole('button', { name: 'Security' }).click();
  await account.getByRole('button', { name: 'Set up two-factor' }).click();

  // Read the secret from the manual-key field and compute a valid code.
  const secret = (await account.getByLabel('TOTP secret key').textContent())?.trim() ?? '';
  expect(secret.length).toBeGreaterThan(0);
  await account.getByLabel('Authentication code').fill(authenticator.generate(secret));
  await account.getByRole('button', { name: 'Enable two-factor' }).click();

  // Recovery codes are revealed once; grab the first for the recovery path, then dismiss.
  const recovery = (await account.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').first().textContent())?.trim() ?? '';
  expect(recovery).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  await account.getByRole('button', { name: 'I’ve saved them' }).click();
  await page.keyboard.press('Escape');

  // Sign out, then sign back in — the password now yields the second-factor step.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('pw-secret-1');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Code step appears; a fresh TOTP code completes the sign-in.
  const codeField = page.getByLabel('Authentication code');
  await expect(codeField).toBeVisible();
  await codeField.fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Verify' }).click();

  // Signed in: the account menu icon is back.
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});
