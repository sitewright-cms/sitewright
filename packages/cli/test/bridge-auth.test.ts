import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeAuth } from '../src/bridge-auth.js';
import { saveCredentials } from '../src/credentials.js';

// bridge-auth's beginLogin delegates to beginDeviceLogin; mock it to assert the wiring (and avoid
// a real device-authorization network call). token()/forceRefresh() don't touch device.js.
vi.mock('../src/device.js', () => ({
  beginDeviceLogin: vi.fn(async () => ({ verificationUrl: 'u', userCode: 'c', expiresIn: 600, completion: Promise.resolve() })),
}));
import { beginDeviceLogin } from '../src/device.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-cli-bridge-'));
  process.env.SITEWRIGHT_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.SITEWRIGHT_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('createBridgeAuth', () => {
  it('is interactive and yields a null token (not an error) when not logged in', async () => {
    const auth = createBridgeAuth('https://cms.test');
    expect(auth.interactive).toBe(true);
    expect(await auth.token()).toBeNull(); // bridge boots unauthenticated → agent must run login
    expect(await auth.forceRefresh()).toBeNull();
  });

  it('returns the stored access token when signed in and not near expiry', async () => {
    saveCredentials('https://cms.test', {
      accessToken: 'swk_live',
      refreshToken: 'swr',
      expiresAt: Date.now() + 3_600_000,
      scope: 'content:read content:write',
    });
    const auth = createBridgeAuth('https://cms.test');
    expect(await auth.token()).toBe('swk_live');
  });

  it('beginLogin delegates to beginDeviceLogin with the issuer + the default agent scope', async () => {
    const auth = createBridgeAuth('https://cms.test');
    const pending = await auth.beginLogin();
    expect(beginDeviceLogin).toHaveBeenCalledWith({ issuer: 'https://cms.test', scope: 'content:read content:write publish' });
    expect(pending.userCode).toBe('c');
  });
});
