import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
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
  const a = await registerAccount(db, 'a@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'a' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  pctx = { userId: a.userId, projectId: project.id, role: 'owner' };
  grant = {
    clientId: CLIENT,
    userId: a.userId,
    projectId: project.id,
    role: 'owner',
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
    expect(resolved).toMatchObject({ projectId: pctx.projectId, role: 'owner' });
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

describe('OAuthRepository — session cap + disconnect (PR-4)', () => {
  it('redeemAuthCode honors a custom refresh expiry (the configurable session cap)', async () => {
    // Issue with an ALREADY-PAST refresh expiry → the refresh token is dead on arrival.
    const tokens = await oauth.redeemAuthCode(
      { code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      new Date(),
      new Date(Date.now() - 1000),
    );
    await expect(oauth.refresh({ refreshToken: tokens.refreshToken, clientId: CLIENT })).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('refresh clamps the rotated token down to a LOWERED instance cap (tightening takes effect now)', async () => {
    const t0 = new Date();
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    // Original grant issued under a generous 720h cap.
    const first = await oauth.redeemAuthCode(
      { code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      t0,
      new Date(t0.getTime() + 720 * 60 * 60 * 1000),
    );
    // Admin lowers the cap to 1h; the rotation passes the new (smaller) cap.
    const lowered = new Date(t0.getTime() + 60 * 60 * 1000);
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }, t0, lowered);
    // The rotated token now dies at the lowered cap — not the original 720h.
    await expect(
      oauth.refresh({ refreshToken: second.refreshToken, clientId: CLIENT }, new Date(lowered.getTime() + 1000)),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('refresh never EXTENDS past the original cap even if the instance cap is raised', async () => {
    const t0 = new Date();
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    // Original grant issued under a small 1h cap.
    const first = await oauth.redeemAuthCode(
      { code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      t0,
      new Date(t0.getTime() + 60 * 60 * 1000),
    );
    // A raised 720h cap must not lengthen the rotated token past the original 1h.
    const raised = new Date(t0.getTime() + 720 * 60 * 60 * 1000);
    const second = await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }, t0, raised);
    await expect(
      oauth.refresh({ refreshToken: second.refreshToken, clientId: CLIENT }, new Date(t0.getTime() + 60 * 60 * 1000 + 1000)),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('revokeAllForUserProject severs the refresh chain AND in-flight access tokens (disconnect)', async () => {
    const tokens = await oauth.redeemAuthCode({ code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    const rotated = await oauth.refresh({ refreshToken: tokens.refreshToken, clientId: CLIENT }); // works before disconnect
    expect(await keys.resolve(rotated.accessToken)).not.toBeNull();

    await oauth.revokeAllForUserProject(grant.userId, grant.projectId);

    // The current refresh token can no longer mint tokens, and the in-flight access token is dead.
    await expect(oauth.refresh({ refreshToken: rotated.refreshToken, clientId: CLIENT })).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await keys.resolve(rotated.accessToken)).toBeNull();
  });
});

describe('OAuthRepository.listActiveSessions (agent presence)', () => {
  it('lists a fresh grant as one live session for the connected user', async () => {
    await oauth.redeemAuthCode({ code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    const sessions = await oauth.listActiveSessions(grant.projectId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ userId: grant.userId, clientId: CLIENT, role: 'owner' });
    expect(sessions[0]!.capabilities).toEqual(['content:read', 'content:write']);
  });

  it('stays a SINGLE session across refresh rotation, preserving the connect time', async () => {
    const t0 = new Date('2030-01-01T00:00:00.000Z');
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    const first = await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }, t0);
    const t1 = new Date(t0.getTime() + 10 * 60 * 1000);
    await oauth.refresh({ refreshToken: first.refreshToken, clientId: CLIENT }, t1);
    const sessions = await oauth.listActiveSessions(grant.projectId, t1);
    expect(sessions).toHaveLength(1); // not two — rotation is the same session
    expect(sessions[0]!.connectedAt.getTime()).toBe(t0.getTime()); // chain root, not the last refresh
  });

  it('stays visible after the 1h access token would have expired, while the refresh session is alive', async () => {
    const t0 = new Date('2030-02-01T00:00:00.000Z');
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    const tokens = await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }, t0);
    // 2h later: the access token (1h TTL) is dead, but the 8h refresh session is still live.
    const t2h = new Date(t0.getTime() + 2 * 60 * 60 * 1000);
    expect(await keys.resolve(tokens.accessToken, t2h)).toBeNull(); // access token expired
    expect(await oauth.listActiveSessions(grant.projectId, t2h)).toHaveLength(1); // session persists
  });

  it('drops the session once past the absolute cap', async () => {
    const t0 = new Date('2030-03-01T00:00:00.000Z');
    const code = await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0);
    await oauth.redeemAuthCode({ code, clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER }, t0);
    const pastCap = new Date(t0.getTime() + REFRESH_TTL_MS + 1000);
    expect(await oauth.listActiveSessions(grant.projectId, pastCap)).toHaveLength(0);
  });

  it('drops the session after a disconnect (revokeAllForUserProject)', async () => {
    await oauth.redeemAuthCode({ code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(await oauth.listActiveSessions(grant.projectId)).toHaveLength(1);
    await oauth.revokeAllForUserProject(grant.userId, grant.projectId);
    expect(await oauth.listActiveSessions(grant.projectId)).toHaveLength(0);
  });

  it('reports last activity from the most recent OAuth access-token use', async () => {
    const tokens = await oauth.redeemAuthCode({ code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect((await oauth.listActiveSessions(grant.projectId))[0]!.lastUsedAt).toBeNull(); // not used yet
    await keys.resolve(tokens.accessToken); // an agent call stamps lastUsedAt
    expect((await oauth.listActiveSessions(grant.projectId))[0]!.lastUsedAt).not.toBeNull();
  });

  it('scopes sessions to the project', async () => {
    await oauth.redeemAuthCode({ code: await authCode(), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER });
    expect(await oauth.listActiveSessions('another-project')).toHaveLength(0);
  });

  it('collapses a user’s multiple live chains into one row, keeping the longest-lived cap', async () => {
    const t0 = new Date('2030-04-01T00:00:00.000Z');
    // Two separate grants (chains) for the same user, with different caps.
    await oauth.redeemAuthCode(
      { code: await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      t0,
      new Date(t0.getTime() + 2 * 60 * 60 * 1000),
    );
    await oauth.redeemAuthCode(
      { code: await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, t0), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      t0,
      new Date(t0.getTime() + 6 * 60 * 60 * 1000),
    );
    const sessions = await oauth.listActiveSessions(grant.projectId, t0);
    expect(sessions).toHaveLength(1); // one row per user
    expect(sessions[0]!.expiresAt.getTime()).toBe(t0.getTime() + 6 * 60 * 60 * 1000); // the longer cap
  });

  it('orders unused sessions deterministically (newest connect first)', async () => {
    // Two users, neither has acted yet (lastUsedAt null) → the connectedAt tiebreak decides order.
    const b = await registerAccount(db, 'b@beta.test', 'pw-secret-2');
    await addProjectMember(db, b.userId, grant.projectId, 'owner');
    const grantB: Grant = { ...grant, userId: b.userId };
    const tEarly = new Date('2030-05-01T00:00:00.000Z');
    const tLate = new Date('2030-05-01T01:00:00.000Z');
    await oauth.redeemAuthCode(
      { code: await oauth.createAuthCode(grant, REDIRECT, CHALLENGE, tEarly), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      tEarly,
    );
    await oauth.redeemAuthCode(
      { code: await oauth.createAuthCode(grantB, REDIRECT, CHALLENGE, tLate), clientId: CLIENT, redirectUri: REDIRECT, codeVerifier: VERIFIER },
      tLate,
    );
    const sessions = await oauth.listActiveSessions(grant.projectId, new Date('2030-05-01T02:00:00.000Z'));
    expect(sessions.map((s) => s.userId)).toEqual([grantB.userId, grant.userId]); // newest connect first
  });
});
