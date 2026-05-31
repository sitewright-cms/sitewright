import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDeviceLogin } from '../src/device.js';
import { loadCredentials } from '../src/credentials.js';
import type { FetchLike, DeviceAuthorization } from '../src/oauth.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-cli-device-'));
  process.env.SITEWRIGHT_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.SITEWRIGHT_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'x', text: async () => JSON.stringify(body) });
const bad = (status: number, body: unknown) => ({ ok: false, status, statusText: 'x', text: async () => JSON.stringify(body) });
const DEVICE_AUTH = {
  device_code: 'swd_x',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://cms.test/oauth/device',
  interval: 1,
  expires_in: 600,
};

describe('runDeviceLogin', () => {
  it('shows the user code, polls through authorization_pending, then stores tokens', async () => {
    let tokenCalls = 0;
    const fetchImpl: FetchLike = async (input) => {
      if (input.endsWith('/oauth/device_authorization')) return ok(DEVICE_AUTH);
      tokenCalls += 1;
      if (tokenCalls === 1) return bad(400, { error: 'authorization_pending' });
      return ok({ access_token: 'swk_a', refresh_token: 'swr_b', expires_in: 3600, scope: 'content:read' });
    };
    let shown: DeviceAuthorization | undefined;
    const tokens = await runDeviceLogin({
      issuer: 'https://cms.test',
      scope: 'content:read',
      prompt: (a) => {
        shown = a;
      },
      fetchImpl,
      sleep: async () => {},
    });
    expect(shown?.userCode).toBe('WDJB-MJHT');
    expect(tokens.accessToken).toBe('swk_a');
    expect(loadCredentials('https://cms.test')?.refreshToken).toBe('swr_b');
    expect(tokenCalls).toBe(2); // pending, then success
  });

  it('backs off on slow_down then succeeds', async () => {
    let tokenCalls = 0;
    const fetchImpl: FetchLike = async (input) => {
      if (input.endsWith('/oauth/device_authorization')) return ok(DEVICE_AUTH);
      tokenCalls += 1;
      if (tokenCalls === 1) return bad(400, { error: 'slow_down' });
      return ok({ access_token: 'swk_a', refresh_token: 'swr_b', expires_in: 3600, scope: '' });
    };
    const tokens = await runDeviceLogin({ issuer: 'https://cms.test', scope: 'content:read', prompt: () => {}, fetchImpl, sleep: async () => {} });
    expect(tokens.accessToken).toBe('swk_a');
  });

  it('uses the default timer when no sleep is injected (interval 0)', async () => {
    const fetchImpl: FetchLike = async (input) =>
      input.endsWith('/oauth/device_authorization')
        ? ok({ ...DEVICE_AUTH, interval: 0 })
        : ok({ access_token: 'swk_a', refresh_token: 'swr_b', expires_in: 3600, scope: '' });
    const tokens = await runDeviceLogin({ issuer: 'https://cms.test', scope: 'content:read', prompt: () => {}, fetchImpl });
    expect(tokens.accessToken).toBe('swk_a');
  });

  it('throws (terminally) when the user denies', async () => {
    const fetchImpl: FetchLike = async (input) =>
      input.endsWith('/oauth/device_authorization') ? ok(DEVICE_AUTH) : bad(400, { error: 'access_denied' });
    await expect(
      runDeviceLogin({ issuer: 'https://cms.test', scope: 'content:read', prompt: () => {}, fetchImpl, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 'access_denied' });
  });
});
