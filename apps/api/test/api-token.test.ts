import { describe, it, expect } from 'vitest';
import { generateApiToken, hashApiToken, isApiTokenFormat } from '../src/auth/api-keys.js';

describe('api token utilities', () => {
  it('generates a swk_-prefixed token with a stored hash and a display prefix', () => {
    const { token, tokenHash, tokenPrefix } = generateApiToken();
    expect(token.startsWith('swk_')).toBe(true);
    expect(token.length).toBeGreaterThan(40); // swk_ + 64 hex chars
    expect(tokenHash).toBe(hashApiToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(token.startsWith(tokenPrefix)).toBe(true);
    expect(tokenPrefix.length).toBe('swk_'.length + 8);
    // The stored material must never be the raw token.
    expect(tokenHash).not.toContain(token);
    expect(tokenPrefix).not.toBe(token);
  });

  it('generates unique tokens', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('hashes deterministically', () => {
    expect(hashApiToken('swk_abc')).toBe(hashApiToken('swk_abc'));
    expect(hashApiToken('swk_abc')).not.toBe(hashApiToken('swk_abd'));
  });

  it('recognizes the token format', () => {
    expect(isApiTokenFormat('swk_deadbeef')).toBe(true);
    expect(isApiTokenFormat('sess_xyz')).toBe(false);
    expect(isApiTokenFormat('')).toBe(false);
  });
});
