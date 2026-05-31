import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { registerAccount, tenantContext } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ApiKeyRepository } from '../src/repo/api-keys.js';
import { OAuthRepository, OAuthError, ACCESS_TTL_MS, REFRESH_TTL_MS, type Grant } from '../src/repo/oauth.js';
import { s256Challenge } from '../src/auth/pkce.js';
import { apiKeys } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';
import type { ProjectContext } from '../src/repo/context.js';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = s256Challenge(VERIFIER);
const REDIRECT = 'http://127.0.0.1:8976/callback';
const CLIENT = 'sitewright-cli';

let db: Database;
let oauth: OAuthRepository;
let keys: ApiKeyRepository;
let pctx: ProjectContext;
let grant: Grant;

beforeEach(async () => {
  db = await makeTestDb();
  oauth = new OAuthRepository(db);
  keys = new ApiKeyRepository(db);
  const a = await registerAccount(db, 'a@acme.test', 'pw-secret-1', 'Acme');
  const tenant = await tenantContext(db, a.userId, a.orgId);
  const project = await new ProjectRepository(db).create(tenant, { name: 'A', slug: 'a' });
  pctx = { ...tenant, projectId: project.id };
  grant = {
    clientId: CLIENT,
    userId: a.userId,
    orgId: a.orgId,
    projectId: project.id,
    role: 'admin',
    scope: ['content:read', 'content:write'],
  };
});

async function authCode(): Promise<string> {
  return oauth.createAuthCode(grant, REDIRECT, CHALLENGE);
}

describe('OAuthRepository — authorization code', () => {
  it('redeems a valid code for an access + refresh token bound to the grant', async () => {
    const code = await authCode();
    const tokens = await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(tokens.accessToken.startsWith('swk_')).toBe(true);
    expect(tokens.refreshToken.startsWith('swr_')).toBe(true);
    expect(tokens.expiresInSeconds).toBe(Math.floor(ACCESS_TTL_MS / 1000));
    // The access token resolves on the normal bearer path with the granted scope.
    const resolved = await keys.resolve(tokens.accessToken);
    expect(resolved).toMatchObject({ projectId: pctx.projectId, role: 'admin' });
    expect(resolved?.capabilities).toEqual(['content:read', 'content:write']);
  });

  it('issues OAuth access tokens that are hidden from the PAT management list', async () => {
    const code = await authCode();
    await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(await keys.list(pctx)).toHaveLength(0); // source='oauth' rows excluded
    const oauthRows = await db.select().from(apiKeys).where(eq(apiKeys.source, 'oauth'));
    expect(oauthRows).toHaveLength(1);
  });

  it('rejects a code reused a second time (single-use)', async () => {
    const code = await authCode();
    await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    await expect(
      oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects a wrong PKCE verifier, wrong redirect_uri, wrong client, and expired code', async () => {
    const wrongPkce = await authCode();
    await expect(
      oauth.redeemAuthCode({ code: wrongPkce, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: 'x'.repeat(43) }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    const wrongRedirect = await authCode();
    await expect(
      oauth.redeemAuthCode({ code: wrongRedirect, clientId: CLIENT, redirectUri: 'http://127.0.0.1:9999/cb', codeVerifier: VERIFIER }),
    ).rejects.toThrow(OAuthError);

    const wrongClient = await authCode();
    await expect(
      oauth.redeemAuthCode({ code: wrongClient, clientId: 'evil', redirectUri: REDIRECT, codeVerifier: VERIFIER }),
    ).rejects.toThrow(OAuthError);

    const expired = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, new Date(Date.now() - 120_000));
    await expect(
      oauth.redeemAuthCode({ code: expired, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects an unknown code', async () => {
    await expect(
      oauth.redeemAuthCode({ code: 'swc_nope', clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('does NOT burn the code on a failed PKCE attempt (intercepted-code resilience)', async () => {
    const code = await authCode();
    // An attacker with the code but not the verifier fails…
    await expect(
      oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: 'x'.repeat(43) }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
    // …and the legitimate client can still redeem with the correct verifier.
    const tokens = await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(tokens.accessToken.startsWith('swk_')).toBe(true);
  });

  it('rejects an authorization request with a malformed PKCE challenge', async () => {
    await expect(oauth.createAuthCode(grant, REDIRECT, 'too-short')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });
});

describe('OAuthRepository — refresh rotation', () => {
  async function firstTokens() {
    const code = await authCode();
    return oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
  }

  it('rotates: a refresh yields new tokens and the old refresh is single-use', async () => {
    const first = await firstTokens();
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect((await keys.resolve(second.accessToken))?.projectId).toBe(pctx.projectId);
    // The original refresh token is now rotated — reusing it is refused.
    await expect(
      oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('treats reuse of a rotated token as theft and revokes the whole chain', async () => {
    const first = await firstTokens();
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT });
    // Reusing the old (rotated) token triggers chain revocation…
    await expect(oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT })).rejects.toThrow(OAuthError);
    // …so even the legitimate latest refresh token is now dead.
    await expect(
      oauth.refresh({ refreshToken: second.refreshToken, clientId: CLIENT }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('revokes in-flight access tokens too when a chain is flagged stolen (no 1h bleed)', async () => {
    const first = await firstTokens();
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT });
    expect(await keys.resolve(second.accessToken)).not.toBeNull(); // currently valid
    // Theft: reusing the rotated token revokes the chain AND the access tokens.
    await expect(oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT })).rejects.toThrow(OAuthError);
    expect(await keys.resolve(second.accessToken)).toBeNull(); // access token now dead
  });

  it('keeps the original absolute expiry across rotations (no indefinite extension)', async () => {
    const t0 = new Date();
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    const first = await oauth.redeemAuthCode(
      { code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      t0,
    );
    // Rotate at t0; the new refresh inherits the ORIGINAL cap (t0 + REFRESH_TTL)…
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }, t0);
    // …so refreshing it just past that cap is refused (activity can't extend forever).
    const pastCap = new Date(t0.getTime() + REFRESH_TTL_MS + 1000);
    await expect(
      oauth.refresh({ refreshToken: second.refreshToken, clientId: CLIENT }, pastCap),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('rejects an unknown or client-mismatched refresh token', async () => {
    const first = await firstTokens();
    await expect(oauth.refresh({ refreshToken: 'swr_nope', clientId: CLIENT })).rejects.toThrow(OAuthError);
    await expect(
      oauth.refresh({ refreshToken: first.refreshToken, clientId: 'evil' }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});
