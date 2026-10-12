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

describe('a registration is verified WITHOUT whatever attestation statement the client sent', () => {
  // Also not mocked. We ask for no attestation, but the library verifies whatever statement arrives —
  // and a statement is attacker-supplied certificates. From v14 that includes fetching the revocation
  // URL written inside them (for `android-key`, against a trust anchor taken from the client's own
  // chain). So the statement never reaches the library: see withoutAttestationStatement.
  const RP = resolveRp('example.com', 'https');
  const CHALLENGE = 'dGhlLWNoYWxsZW5nZQ';

  /** A registration response as a browser would post it: a fresh EC credential, any attestation. */
  async function registration(fmt: string, attStmt: Map<string, unknown>, key: 'ES256' | 'ES384' = 'ES256') {
    const { createHash, generateKeyPairSync, randomBytes } = await import('node:crypto');
    const { isoCBOR } = await import('@simplewebauthn/server/helpers');
    const es384 = key === 'ES384';
    const jwk = generateKeyPairSync('ec', { namedCurve: es384 ? 'P-384' : 'P-256' }).publicKey.export({ format: 'jwk' });
    const coseKey = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, es384 ? -35 : -7], // alg
      [-1, es384 ? 2 : 1], // crv
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]);
    const credentialId = randomBytes(16);
    const authData = Buffer.concat([
      createHash('sha256').update(RP.rpID).digest(),
      Buffer.from([0x41]), // flags: user present + attested credential data
      Buffer.alloc(4), // counter
      Buffer.alloc(16), // aaguid
      Buffer.from([0, credentialId.length]),
      credentialId,
      Buffer.from(isoCBOR.encode(coseKey as never)),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([['fmt', fmt], ['attStmt', attStmt], ['authData', new Uint8Array(authData)]]) as never,
    );
    const id = credentialId.toString('base64url');
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: CHALLENGE, origin: RP.origin, crossOrigin: false })).toString('base64url'),
        attestationObject: Buffer.from(attestationObject).toString('base64url'),
        transports: ['internal' as const],
      },
    };
  }

  it('an ordinary `none` registration verifies, through the re-encoding every registration takes', async () => {
    const { verifyRegistration } = await import('../src/auth/webauthn.js');
    const response = await registration('none', new Map());
    const result = await verifyRegistration({ rp: RP, response, expectedChallenge: CHALLENGE });
    expect(result.verified).toBe(true);
    expect(result.registrationInfo?.credential.id).toBe(response.id);
    expect(result.registrationInfo?.credential.publicKey.byteLength).toBeGreaterThan(0);
    expect(result.registrationInfo?.fmt).toBe('none');
    // …and everything that IS relied on is still checked.
    await expect(verifyRegistration({ rp: RP, response, expectedChallenge: 'YW5vdGhlci1jaGFsbGVuZ2U' })).rejects.toThrow();
    await expect(verifyRegistration({ rp: resolveRp('evil.example', 'https'), response, expectedChallenge: CHALLENGE })).rejects.toThrow();
  });

  it('★ a statement full of certificates is never handed to the library — no parsing, no fetch', async () => {
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    const { decodeAttestationObject, isoBase64URL } = await import('@simplewebauthn/server/helpers');
    const { verifyRegistration, withoutAttestationStatement, PASSKEY_ALGORITHMS } = await import('../src/auth/webauthn.js');
    // What an attacker posts: the `android-key` format, with a certificate chain of their own making.
    const hostile = await registration(
      'android-key',
      new Map<string, unknown>([
        ['alg', -7],
        ['sig', new Uint8Array(64)],
        ['x5c', [new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]), new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x02])]],
      ]),
    );
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      fetched.push(String(url));
      throw new Error('no network in this test');
    }) as typeof fetch;
    try {
      // The presence guard: given as posted, the library DOES take up the statement (and rejects this
      // crude one) — so stripping it is what stands between a better-made one and the code that
      // fetches. If this ever resolves, the statement was ignored and the guard proves nothing.
      await expect(
        verifyRegistrationResponse({
          response: hostile,
          expectedChallenge: CHALLENGE,
          expectedOrigin: RP.origin,
          expectedRPID: RP.rpID,
          requireUserVerification: false,
          supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
        }),
      ).rejects.toThrow();

      // Ours: what the library is given says `none` and carries the same authenticator data…
      const bare = decodeAttestationObject(isoBase64URL.toBuffer(withoutAttestationStatement(hostile).response.attestationObject));
      const posted = decodeAttestationObject(isoBase64URL.toBuffer(hostile.response.attestationObject));
      expect(bare.get('fmt')).toBe('none');
      expect(bare.get('attStmt').size).toBe(0);
      expect(Buffer.from(bare.get('authData')).equals(Buffer.from(posted.get('authData')))).toBe(true);
      // …so the registration is judged on that alone, and nothing went out.
      const result = await verifyRegistration({ rp: RP, response: hostile, expectedChallenge: CHALLENGE });
      expect(result.verified).toBe(true);
      expect(result.registrationInfo?.fmt).toBe('none');
      expect(result.registrationInfo?.credential.id).toBe(hostile.id);
      expect(fetched).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a credential in an algorithm that was never offered is refused at verification too', async () => {
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server');
    const { verifyRegistration } = await import('../src/auth/webauthn.js');
    const es384 = await registration('none', new Map(), 'ES384');
    // The presence guard: it is a perfectly good registration to a server that offers ES384…
    const elsewhere = await verifyRegistrationResponse({
      response: es384,
      expectedChallenge: CHALLENGE,
      expectedOrigin: RP.origin,
      expectedRPID: RP.rpID,
      requireUserVerification: false,
      supportedAlgorithmIDs: [-35],
    });
    expect(elsewhere.verified).toBe(true);
    // …and not to this one, which offered EdDSA, ES256 and RS256 and accepts nothing else.
    await expect(verifyRegistration({ rp: RP, response: es384, expectedChallenge: CHALLENGE })).rejects.toThrow(/Unexpected public key alg "-35"/);
  });

  it('a response that is not an attestation object at all is refused, not passed along', async () => {
    const { verifyRegistration } = await import('../src/auth/webauthn.js');
    const response = await registration('none', new Map());
    const garbage = { ...response, response: { ...response.response, attestationObject: Buffer.from('not cbor').toString('base64url') } };
    await expect(verifyRegistration({ rp: RP, response: garbage, expectedChallenge: CHALLENGE })).rejects.toThrow();
  });
});
