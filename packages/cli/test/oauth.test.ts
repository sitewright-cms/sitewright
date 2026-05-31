import { describe, it, expect } from 'vitest';
import { generateVerifier, challengeFor, generateState } from '../src/pkce.js';
import {
  buildAuthorizeUrl,
  parseCallback,
  exchangeCode,
  refreshTokens,
  type FetchLike,
} from '../src/oauth.js';
import { createHash } from 'node:crypto';

function b64url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('pkce', () => {
  it('generates a valid verifier and the matching S256 challenge', () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(challengeFor(v)).toBe(b64url(createHash('sha256').update(v).digest()));
    expect(generateState()).not.toBe(generateState());
  });
});

describe('buildAuthorizeUrl', () => {
  it('builds the authorize URL with PKCE + the CLI client', () => {
    const url = new URL(
      buildAuthorizeUrl({ issuer: 'https://cms.test/', redirectUri: 'http://127.0.0.1:9/cb', challenge: 'C', scope: 'content:read', state: 'S' }),
    );
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('sitewright-cli');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9/cb');
    expect(url.searchParams.get('state')).toBe('S');
  });
});

describe('parseCallback', () => {
  it('extracts a code only when state matches', () => {
    expect(parseCallback(new URLSearchParams('code=abc&state=S'), 'S')).toEqual({ code: 'abc' });
    expect(parseCallback(new URLSearchParams('code=abc&state=X'), 'S')).toEqual({ error: 'state_mismatch' });
    expect(parseCallback(new URLSearchParams('state=S'), 'S')).toEqual({ error: 'missing_code' });
    expect(parseCallback(new URLSearchParams('error=access_denied&state=S'), 'S')).toEqual({ error: 'access_denied' });
  });
});

function fakeFetch(handler: (input: string, init?: { body?: string }) => { status: number; body: string }) {
  const calls: Array<{ input: string; body?: string }> = [];
  const impl: FetchLike = async (input, init) => {
    calls.push({ input, body: init?.body });
    const r = handler(input, init);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: 'x', text: async () => r.body };
  };
  return { impl, calls };
}

describe('token exchange + refresh', () => {
  it('exchanges a code (form-encoded) and computes absolute expiry', async () => {
    const fake = fakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ access_token: 'swk_a', refresh_token: 'swr_b', expires_in: 3600, scope: 'content:read' }),
    }));
    const before = Date.now();
    const tokens = await exchangeCode({ issuer: 'https://cms.test', code: 'c', redirectUri: 'http://127.0.0.1:9/cb', verifier: 'v' }, fake.impl);
    expect(tokens.accessToken).toBe('swk_a');
    expect(tokens.refreshToken).toBe('swr_b');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    expect(fake.calls[0]!.input).toBe('https://cms.test/oauth/token');
    const sent = new URLSearchParams(fake.calls[0]!.body);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toBe('v');
  });

  it('refreshes with grant_type=refresh_token', async () => {
    const fake = fakeFetch(() => ({ status: 200, body: JSON.stringify({ access_token: 'swk_n', refresh_token: 'swr_n', expires_in: 3600, scope: '' }) }));
    await refreshTokens({ issuer: 'https://cms.test', refreshToken: 'swr_old' }, fake.impl);
    const sent = new URLSearchParams(fake.calls[0]!.body);
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('swr_old');
  });

  it('throws with the server error on failure', async () => {
    const fake = fakeFetch(() => ({ status: 400, body: JSON.stringify({ error: 'invalid_grant' }) }));
    await expect(refreshTokens({ issuer: 'https://cms.test', refreshToken: 'x' }, fake.impl)).rejects.toThrow(/invalid_grant/);
  });
});
