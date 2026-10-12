import { test as base, expect, type Locator, type Page } from '@playwright/test';
import net from 'node:net';
import { E2E_PASSWORD, dismissProjectSelector, signUp } from './helpers.js';

const stamp = Date.now();

const SLOT = new URL(process.env.E2E_BASE_URL ?? 'http://dind.local:2003');

/**
 * WebAuthn only exists in a SECURE CONTEXT. The slot is plain `http://<host>:<port>`, so
 * `window.PublicKeyCredential` is undefined there — the editor correctly renders "this browser
 * doesn't support passkeys" and disables the button, leaving nothing to test. (The obvious fix,
 * `--unsafely-treat-insecure-origin-as-secure`, does NOT work: the bundled `chromium-headless-shell`
 * ignores it — verified, `isSecureContext` stayed false.)
 *
 * `localhost` is trustworthy by definition whatever the scheme, so this file — and only this file —
 * reaches the same slot through a loopback TCP forwarder and gets a real WebAuthn implementation.
 * It has to be a real forwarder rather than `--host-resolver-rules=MAP localhost <host>`: that maps
 * DNS for the BROWSER only, while `page.request` (which the sign-up helper uses, and which shares
 * the browser's cookie jar) is issued from Node and would still hit a dead ::1.
 *
 * The server derives the WebAuthn RP from the request Host, so it sees rpID `localhost` and origin
 * `http://localhost:<port>` — self-consistent with what the browser sends.
 */
const test = base.extend<Record<string, never>, { loopbackSlot: string }>({
  loopbackSlot: [
    // Playwright REQUIRES the destructuring pattern on a fixture's first parameter (it reads the
    // fixture names from it) — this one depends on none, so the pattern is necessarily empty.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const live = new Set<net.Socket>();
      const server = net.createServer((client) => {
        const upstream = net.connect(Number(SLOT.port || 80), SLOT.hostname);
        live.add(client).add(upstream);
        client.pipe(upstream);
        upstream.pipe(client);
        const drop = () => {
          live.delete(client);
          live.delete(upstream);
          client.destroy();
          upstream.destroy();
        };
        client.on('error', drop).on('close', drop);
        upstream.on('error', drop).on('close', drop);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await use(`http://localhost:${(server.address() as net.AddressInfo).port}`);
      // `close()` alone only stops NEW connections and then waits — keep-alive sockets from the
      // browser and from page.request would hold teardown open until the fixture times out.
      for (const socket of live) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ loopbackSlot }, use) => {
    await use(loopbackSlot);
  },
});

/**
 * Security tab → "Add a passkey": the name, then the account password (a passkey is a way to sign in,
 * so adding one is confirmed), then the virtual authenticator approves on its own.
 */
async function addPasskey(page: Page, account: Locator, name: string): Promise<void> {
  await account.getByRole('button', { name: 'Security' }).click();
  await account.getByRole('button', { name: 'Add a passkey' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'Add a passkey' });
  await namePrompt.getByLabel('Name').fill(name);
  await namePrompt.getByRole('button', { name: 'Continue' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm it is you' });
  // Masked, like any password field.
  await expect(confirm.getByLabel('Your password')).toHaveAttribute('type', 'password');
  await confirm.getByLabel('Your password').fill(E2E_PASSWORD);
  await confirm.getByRole('button', { name: 'Continue' }).click();
  await expect(account.getByText(name)).toBeVisible();
}

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
  await signUp(page, email);

  // Security tab → add a passkey (the name prompt, then the virtual authenticator auto-approves).
  await dismissProjectSelector(page); // the first-load overlay covers the header
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account Settings' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });
  await addPasskey(page, account, 'Virtual Key');

  // Sign out, then sign in with the passkey (no TOTP → straight in).
  // The modal's header tabs include an "Account" button — wait for it to be gone, not just for the
  // header button to become clickable, or the locator resolves to 2 elements and fails strict mode.
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();

  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});

// A member token can be confirmed with a passkey instead of the password. That is only sound because
// ADDING a passkey is itself confirmed with the password — so this spec shows both halves.
test('a member token is created with a passkey, with no password typed', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await signUp(page, `pk-token-${stamp}@e2e.test`);
  await dismissProjectSelector(page);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Account Settings' }).click();
  const account = page.getByRole('dialog', { name: 'Account' });

  // Before there is a passkey, the password is the only way to confirm.
  await account.getByRole('button', { name: 'Access keys' }).click();
  const memberTokens = account.getByRole('region', { name: 'Member tokens' });
  await expect(memberTokens.getByLabel('Your password')).toBeVisible();
  await expect(memberTokens.getByRole('button', { name: /passkey/ })).toHaveCount(0);

  // A wrong password does not add a passkey — a session alone cannot give itself a way to sign in.
  await account.getByRole('button', { name: 'Security' }).click();
  await account.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByRole('dialog', { name: 'Add a passkey' }).getByRole('button', { name: 'Continue' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm it is you' });
  await confirm.getByLabel('Your password').fill('not-the-password');
  await confirm.getByRole('button', { name: 'Continue' }).click();
  await expect(account.getByText('current password is incorrect')).toBeVisible();
  await expect(account.getByRole('button', { name: /^Remove / })).toHaveCount(0);

  await addPasskey(page, account, 'Token Key');

  // Now the passkey is offered beside the password, and confirms the mint by itself.
  await account.getByRole('button', { name: 'Access keys' }).click();
  await memberTokens.getByLabel('Member token name').fill('Passkey fleet');
  await memberTokens.getByRole('button', { name: 'Create with a passkey instead' }).click();
  await expect(account.getByLabel('New member token')).toContainText(/^swm_[0-9a-f]{64}$/);
  await expect(memberTokens.getByText('Passkey fleet')).toBeVisible();
  await expect(memberTokens.getByLabel('Your password')).toHaveValue('');
});
