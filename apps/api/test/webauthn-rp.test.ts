import { describe, it, expect, vi } from 'vitest';
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

describe('the algorithms a passkey may be registered with', () => {
  // Not mocked: these run the real @simplewebauthn/server, because the point is what IT does by default.

  it('offers exactly EdDSA, ES256 and RS256, and passes stored transports straight through', async () => {
    const { registrationOptions, authenticationOptions, PASSKEY_ALGORITHMS } = await import('../src/auth/webauthn.js');
    expect(PASSKEY_ALGORITHMS).toEqual([-8, -7, -257]);
    const rp = resolveRp('example.com', 'https');
    const reg = await registrationOptions({ rp, userId: 'u1', userName: 'user@x.test', existing: [{ id: 'Y3JlZDE', transports: ['usb', 'hybrid'] }] });
    expect(reg.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257]);
    expect(reg.excludeCredentials).toEqual([{ id: 'Y3JlZDE', type: 'public-key', transports: ['usb', 'hybrid'] }]);
    const auth = await authenticationOptions({ rp, allow: [{ id: 'Y3JlZDE', transports: ['internal'] }] });
    expect(auth.allowCredentials).toEqual([{ id: 'Y3JlZDE', type: 'public-key', transports: ['internal'] }]);
  });

  it('★ does not start offering a post-quantum algorithm just because the runtime can do one', async () => {
    // From v14 the library's own default puts ML-DSA-44 first wherever Node supports it (24.7+). A
    // passkey registered that way only verifies on such a runtime — so it would stop working when an
    // instance moves from a newer Node to the published image. Pretend to be that newer runtime.
    const { SettingsService, generateRegistrationOptions } = await import('@simplewebauthn/server');
    const { registrationOptions } = await import('../src/auth/webauthn.js');
    const spy = vi.spyOn(SettingsService, 'runtimeSupportsPQC').mockReturnValue(true);
    try {
      // The presence guard: left to itself, the library WOULD offer it here…
      const theirs = await generateRegistrationOptions({ rpName: 'x', rpID: 'example.com', userName: 'user@x.test' });
      expect(theirs.pubKeyCredParams[0]?.alg).toBe(-48);
      // …and ours does not.
      const ours = await registrationOptions({ rp: resolveRp('example.com', 'https'), userId: 'u1', userName: 'user@x.test', existing: [] });
      expect(ours.pubKeyCredParams.map((p) => p.alg)).toEqual([-8, -7, -257]);
    } finally {
      spy.mockRestore();
    }
  });
});
