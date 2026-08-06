import { test as base, expect } from '@playwright/test';
import net from 'node:net';
import { dismissProjectSelector, signUp } from './helpers.js';

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
  await account.getByRole('button', { name: 'Security' }).click();
  await account.getByRole('button', { name: 'Add a passkey' }).click();
  const namePrompt = page.getByRole('dialog', { name: 'Add a passkey' });
  await namePrompt.getByLabel('Name').fill('Virtual Key');
  await namePrompt.getByRole('button', { name: 'Continue' }).click();
  await expect(account.getByText('Virtual Key')).toBeVisible();

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
