import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogin } from '../src/login.js';
import { loadCredentials } from '../src/credentials.js';
import type { FetchLike } from '../src/oauth.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sw-cli-login-'));
  process.env.SITEWRIGHT_CONFIG_DIR = dir;
});
afterEach(() => {
  delete process.env.SITEWRIGHT_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

// Stand-in for the OAuth server's token endpoint.
const tokenFetch: FetchLike = async (input, init) => {
  expect(input).toBe('https://cms.test/oauth/token');
  const body = new URLSearchParams(init?.body);
  expect(body.get('grant_type')).toBe('authorization_code');
  expect(body.get('code')).toBe('the-code');
  expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  return {
    ok: true,
    status: 200,
    statusText: 'x',
    text: async () => JSON.stringify({ access_token: 'swk_a', refresh_token: 'swr_b', expires_in: 3600, scope: 'content:read' }),
  };
};

describe('runLogin (loopback + PKCE orchestration)', () => {
  it('drives the loopback callback, exchanges the code, and persists tokens', async () => {
    // The injected "browser" reads the authorize URL and hits the loopback callback
    // with a code + the matching state — exactly what the consent redirect would do.
    const open = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      await fetch(`${redirect}?code=the-code&state=${encodeURIComponent(state)}`);
    };
    const tokens = await runLogin({ issuer: 'https://cms.test', scope: 'content:read', open, fetchImpl: tokenFetch });
    expect(tokens.accessToken).toBe('swk_a');
    expect(loadCredentials('https://cms.test')?.refreshToken).toBe('swr_b');
  });

  it('rejects when the callback carries an error', async () => {
    const open = async (authorizeUrl: string) => {
      const u = new URL(authorizeUrl);
      const redirect = u.searchParams.get('redirect_uri')!;
      const state = u.searchParams.get('state')!;
      await fetch(`${redirect}?error=access_denied&state=${encodeURIComponent(state)}`);
    };
    await expect(
      runLogin({ issuer: 'https://cms.test', scope: 'content:read', open, fetchImpl: tokenFetch, timeoutMs: 5000 }),
    ).rejects.toThrow(/access_denied/);
  });
});
