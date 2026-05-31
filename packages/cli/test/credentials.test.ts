import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, saveCredentials, clearCredentials, configDir } from '../src/credentials.js';
import { ensureAccessToken, forceRefreshAccessToken } from '../src/session.js';
import type { FetchLike, TokenSet } from '../src/oauth.js';

let dir: string;
const tokens: TokenSet = { accessToken: 'swk_a', refreshToken: 'swr_b', expiresAt: Date.now() + 3600_000, scope: 'content:read' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-cli-'));
  process.env.SITEWRIGHT_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.SITEWRIGHT_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('credential store', () => {
  it('round-trips per-issuer credentials and isolates issuers', () => {
    expect(loadCredentials('https://a.test')).toBeNull();
    saveCredentials('https://a.test/', tokens); // trailing slash normalized
    saveCredentials('https://b.test', { ...tokens, accessToken: 'swk_other' });
    expect(loadCredentials('https://a.test')).toEqual(tokens);
    expect(loadCredentials('https://b.test')?.accessToken).toBe('swk_other');
    expect(configDir()).toBe(dir);
  });

  it('writes the credentials file 0600 (owner-only)', () => {
    saveCredentials('https://a.test', tokens);
    const mode = statSync(join(dir, 'credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clears credentials', () => {
    saveCredentials('https://a.test', tokens);
    clearCredentials('https://a.test');
    expect(loadCredentials('https://a.test')).toBeNull();
  });
});

describe('ensureAccessToken', () => {
  const noFetch: FetchLike = async () => {
    throw new Error('should not refresh');
  };

  it('returns the cached token when it is still fresh', async () => {
    saveCredentials('https://a.test', tokens);
    expect(await ensureAccessToken('https://a.test', noFetch)).toBe('swk_a');
  });

  it('refreshes + persists when the token is near expiry', async () => {
    saveCredentials('https://a.test', { ...tokens, expiresAt: Date.now() + 1000 });
    const refreshFetch: FetchLike = async (input) => {
      expect(input).toBe('https://a.test/oauth/token');
      return {
        ok: true,
        status: 200,
        statusText: 'x',
        text: async () => JSON.stringify({ access_token: 'swk_fresh', refresh_token: 'swr_new', expires_in: 3600, scope: '' }),
      };
    };
    expect(await ensureAccessToken('https://a.test', refreshFetch)).toBe('swk_fresh');
    // The rotation was persisted.
    expect(loadCredentials('https://a.test')?.refreshToken).toBe('swr_new');
  });

  it('throws a helpful error when not logged in', async () => {
    await expect(ensureAccessToken('https://a.test', noFetch)).rejects.toThrow(/sitewright login/);
  });

  describe('forceRefreshAccessToken', () => {
    const okFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      statusText: 'x',
      text: async () => JSON.stringify({ access_token: 'swk_forced', refresh_token: 'swr_n2', expires_in: 3600, scope: '' }),
    });

    it('always refreshes (even when not near expiry) and persists the rotation', async () => {
      saveCredentials('https://a.test', tokens); // expiry far in the future
      expect(await forceRefreshAccessToken('https://a.test', okFetch)).toBe('swk_forced');
      expect(loadCredentials('https://a.test')?.refreshToken).toBe('swr_n2');
    });

    it('returns null when not logged in or the refresh fails (caller surfaces the 401)', async () => {
      expect(await forceRefreshAccessToken('https://a.test', okFetch)).toBeNull(); // no creds
      saveCredentials('https://a.test', tokens);
      const failing: FetchLike = async () => ({ ok: false, status: 400, statusText: 'x', text: async () => '{"error":"invalid_grant"}' });
      expect(await forceRefreshAccessToken('https://a.test', failing)).toBeNull();
    });
  });

  it('propagates a refresh failure (expired/revoked refresh token)', async () => {
    saveCredentials('https://a.test', { ...tokens, expiresAt: Date.now() + 1000 });
    const failing: FetchLike = async () => ({
      ok: false,
      status: 400,
      statusText: 'x',
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    });
    await expect(ensureAccessToken('https://a.test', failing)).rejects.toThrow(/invalid_grant/);
  });
});
