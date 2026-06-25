import { describe, it, expect } from 'vitest';
import { resolveRp, firstForwardedValue } from '../src/auth/webauthn.js';

describe('webauthn RP resolution', () => {
  it('derives rpID (host without port) + origin (scheme + host) from the request', () => {
    expect(resolveRp('dind.local:2003', 'http')).toEqual({ rpID: 'dind.local', origin: 'http://dind.local:2003' });
  });

  it('lets the explicit env override win', () => {
    expect(resolveRp('app:80', 'http', { rpID: 'example.com', origin: 'https://example.com' })).toEqual({
      rpID: 'example.com',
      origin: 'https://example.com',
    });
  });

  it('defaults a missing host to localhost', () => {
    expect(resolveRp(undefined, 'https').rpID).toBe('localhost');
  });

  it('firstForwardedValue takes the leftmost of a chained / array forwarded header', () => {
    expect(firstForwardedValue('https, http')).toBe('https'); // chained through two proxies
    expect(firstForwardedValue(['https', 'http'])).toBe('https'); // duplicate-header array form
    expect(firstForwardedValue(['https, http'])).toBe('https'); // single array element, itself chained
    expect(firstForwardedValue(['', 'https'])).toBe('https'); // skips an empty leading entry
    expect(firstForwardedValue('https')).toBe('https');
    expect(firstForwardedValue(undefined)).toBeUndefined();
    expect(firstForwardedValue('')).toBeUndefined();
  });

  it('keeps a forwarded host port in the origin but strips it from rpID', () => {
    const host = firstForwardedValue('example.com:8443')!;
    expect(resolveRp(host, 'https')).toEqual({ rpID: 'example.com', origin: 'https://example.com:8443' });
  });

  it('behind a TLS-terminating proxy, forwarded proto+host yield the https origin (the bug fix)', () => {
    // Mirrors rpFor: prefer X-Forwarded-* over the plain-HTTP connection to the container.
    const protocol = firstForwardedValue('https') ?? 'http';
    const host = firstForwardedValue('dind.buchweitz.house') ?? 'container:80';
    expect(resolveRp(host, protocol)).toEqual({ rpID: 'dind.buchweitz.house', origin: 'https://dind.buchweitz.house' });
  });

  it('with no forwarded headers (direct connection), falls back to the connection proto/host', () => {
    const protocol = firstForwardedValue(undefined) ?? 'http';
    const host = firstForwardedValue(undefined) ?? 'dind.local:2003';
    expect(resolveRp(host, protocol)).toEqual({ rpID: 'dind.local', origin: 'http://dind.local:2003' });
  });
});
