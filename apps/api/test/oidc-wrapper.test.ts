import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { completeOidcAuth, startOidcAuth, type OidcProviderRuntime } from '../src/auth/oidc.js';

const KID = 'test-key';

/**
 * A minimal in-process OpenID Provider: serves discovery + JWKS + a token endpoint that returns a
 * freshly jose-signed ID token. Lets the REAL openid-client wrapper run end-to-end (discovery, PKCE
 * request, ID-token signature + nonce validation) without an external IdP.
 */
async function startMockIdp(): Promise<{
  issuer: string;
  setNextIdToken: (claims: { sub: string; email?: string; email_verified?: boolean; nonce: string; aud: string }) => void;
  close: () => Promise<void>;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  let issuer = '';
  let nextIdToken: Promise<string> | null = null;

  const server: Server = createServer((req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/.well-known/openid-configuration') {
      json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    } else if (req.url === '/jwks') {
      json({ keys: [publicJwk] });
    } else if (req.url === '/token' && req.method === 'POST') {
      void (async () => {
        const idToken = nextIdToken ? await nextIdToken : '';
        json({ access_token: 'access-tok', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
      })();
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  issuer = `http://127.0.0.1:${addr.port}`;

  return {
    issuer,
    setNextIdToken: (c) => {
      nextIdToken = new SignJWT({ email: c.email, email_verified: c.email_verified, nonce: c.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(c.aud)
        .setSubject(c.sub)
        .setExpirationTime('5m')
        .sign(privateKey);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('OIDC wrapper (real openid-client against a mock IdP)', () => {
  let idp: Awaited<ReturnType<typeof startMockIdp>>;
  let provider: OidcProviderRuntime;
  beforeEach(async () => {
    idp = await startMockIdp();
    provider = { id: `mock-${idp.issuer.slice(-5)}`, issuer: idp.issuer, clientId: 'client-1', clientSecret: 'secret', scopes: ['openid', 'email'] };
  });
  afterEach(async () => {
    await idp.close();
  });

  it('discovers the IdP and builds an authorization URL with PKCE + state + nonce', async () => {
    const start = await startOidcAuth(provider, 'http://localhost/cb');
    const url = new URL(start.url);
    expect(`${url.protocol}//${url.host}`).toBe(idp.issuer);
    expect(url.pathname).toBe('/authorize');
    expect(url.searchParams.get('state')).toBe(start.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('openid');
  });

  it('completes the callback: validates the signed ID token + nonce and returns the claims', async () => {
    const start = await startOidcAuth(provider, 'http://localhost/cb');
    idp.setNextIdToken({ sub: 'user-1', email: 'a@b.co', email_verified: true, nonce: start.nonce, aud: 'client-1' });
    const claims = await completeOidcAuth(
      provider,
      new URL(`http://localhost/cb?code=abc&state=${start.state}`),
      { state: start.state, nonce: start.nonce, codeVerifier: start.codeVerifier },
    );
    expect(claims).toEqual({ iss: idp.issuer, sub: 'user-1', email: 'a@b.co', emailVerified: true });
  });

  it('rejects an ID token whose nonce does not match the request (replay/CSRF defense)', async () => {
    const start = await startOidcAuth(provider, 'http://localhost/cb');
    idp.setNextIdToken({ sub: 'user-1', email: 'a@b.co', email_verified: true, nonce: 'WRONG-NONCE', aud: 'client-1' });
    await expect(
      completeOidcAuth(provider, new URL(`http://localhost/cb?code=abc&state=${start.state}`), { state: start.state, nonce: start.nonce, codeVerifier: start.codeVerifier }),
    ).rejects.toMatchObject({ name: 'OidcError' });
  });
});
