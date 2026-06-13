import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Passkeys end-to-end via Chrome's CDP virtual authenticator (no real device). Register a passkey
// from the Security tab, then sign out and sign back in with it.
test('register a passkey and sign in with it', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const email = `pk-e2e-${stamp}@e2e.test`;
  await page.goto('/');
  await page.getByRole('button', { name: /Register/ }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Security tab → add a passkey (the name prompt, then the virtual authenticator auto-approves).
  await page.getByRole('button', { name: 'Account' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });
  await account.getByRole('button', { name: 'Security' }).click();
  await account.getByRole('button', { name: 'Add a passkey' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'Add a passkey' });
  await namePrompt.getByLabel('Name').fill('Virtual Key');
  await namePrompt.getByRole('button', { name: 'Continue' }).click();
  await expect(account.getByText('Virtual Key')).toBeVisible();

  // Sign out, then sign in with the passkey (no TOTP → straight in).
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();

  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});
