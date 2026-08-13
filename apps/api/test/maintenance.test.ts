import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import {
  DEAD_PAT_RETENTION_DAYS,
  OAUTH_CLIENT_RETENTION_DAYS,
  reapDeadPats,
  reapUnusedOAuthClients,
  sweepExpiredAuthRows,
} from '../src/repo/maintenance.js';
import {
  apiKeys,
  oauthClients,
  mfaLoginTickets,
  oauthAuthCodes,
  oauthDeviceCodes,
  oauthRefreshTokens,
  projects,
  sessions,
  users,
  webauthnChallenges,
} from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

async function seedUser(db: Database): Promise<void> {
  await db.insert(users).values({ id: 'u1', email: 'a@b.co', passwordHash: 'x', createdAt: new Date() });
}

async function seedProject(db: Database): Promise<void> {
  await db.insert(projects).values({ id: 'p1', name: 'P', slug: 'p', createdAt: new Date() });
}

describe('sweepExpiredAuthRows', () => {
  it('deletes expired sessions / MFA tickets / WebAuthn challenges, keeps the live ones', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60_000);

    await db.insert(sessions).values([
      { id: 's-old', userId: 'u1', expiresAt: past, createdAt: past },
      { id: 's-new', userId: 'u1', expiresAt: future, createdAt: now },
    ]);
    await db.insert(mfaLoginTickets).values([
      { id: 't-old', userId: 'u1', expiresAt: past, createdAt: past },
      { id: 't-new', userId: 'u1', expiresAt: future, createdAt: now },
    ]);
    await db.insert(webauthnChallenges).values([
      { id: 'c-old', userId: 'u1', challenge: 'x', type: 'auth', expiresAt: past, createdAt: past },
      { id: 'c-new', userId: null, challenge: 'y', type: 'reg', expiresAt: future, createdAt: now },
    ]);

    await sweepExpiredAuthRows(db, now);

    expect((await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id)).toEqual(['s-new']);
    expect((await db.select({ id: mfaLoginTickets.id }).from(mfaLoginTickets)).map((r) => r.id)).toEqual(['t-new']);
    expect((await db.select({ id: webauthnChallenges.id }).from(webauthnChallenges)).map((r) => r.id)).toEqual(['c-new']);
  });

  it('is a safe no-op when there is nothing expired', async () => {
    const db = await makeTestDb();
    await expect(sweepExpiredAuthRows(db)).resolves.toBeUndefined();
  });

  it('deletes expired OAuth grant rows, and keeps every row an access path could still accept', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    await seedProject(db);
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60_000);
    const grant = { clientId: 'c1', userId: 'u1', projectId: 'p1', role: 'owner' as const, scope: ['content:read' as const] };

    // An OAuth access token is an api_keys row with source='oauth'; one is minted per hour of an
    // active grant. A PAT is user-managed and listed in the editor — an expired one must SURVIVE.
    await db.insert(apiKeys).values([
      { id: 'k-oauth-old', projectId: 'p1', name: 'oauth:c1', role: 'owner', capabilities: [], tokenHash: 'h1', tokenPrefix: 'swk_1', expiresAt: past, createdBy: 'u1', source: 'oauth', createdAt: past },
      { id: 'k-oauth-live', projectId: 'p1', name: 'oauth:c1', role: 'owner', capabilities: [], tokenHash: 'h2', tokenPrefix: 'swk_2', expiresAt: future, createdBy: 'u1', source: 'oauth', createdAt: now },
      { id: 'k-pat-old', projectId: 'p1', name: 'my key', role: 'owner', capabilities: [], tokenHash: 'h3', tokenPrefix: 'swk_3', expiresAt: past, createdBy: 'u1', source: 'pat', createdAt: past },
    ]);
    await db.insert(oauthRefreshTokens).values([
      { id: 'r-old', ...grant, expiresAt: past, createdAt: past },
      { id: 'r-live', ...grant, expiresAt: future, createdAt: now },
    ]);
    // A CONSUMED code must outlive its use, up to its expiry — that row is what refuses a replay.
    await db.insert(oauthAuthCodes).values([
      { id: 'a-old', ...grant, redirectUri: 'http://127.0.0.1/cb', codeChallenge: 'x', expiresAt: past, consumedAt: past, createdAt: past },
      { id: 'a-live-consumed', ...grant, redirectUri: 'http://127.0.0.1/cb', codeChallenge: 'y', expiresAt: future, consumedAt: now, createdAt: now },
    ]);
    await db.insert(oauthDeviceCodes).values([
      { id: 'd-old', userCode: 'AAAA', clientId: 'c1', scope: [], status: 'pending', expiresAt: past, createdAt: past },
      { id: 'd-live', userCode: 'BBBB', clientId: 'c1', scope: [], status: 'pending', expiresAt: future, createdAt: now },
    ]);

    await sweepExpiredAuthRows(db, now);

    const ids = async (t: typeof apiKeys | typeof oauthRefreshTokens | typeof oauthAuthCodes | typeof oauthDeviceCodes): Promise<string[]> =>
      (await db.select({ id: t.id }).from(t)).map((r) => r.id).sort();
    expect(await ids(apiKeys)).toEqual(['k-oauth-live', 'k-pat-old']);
    expect(await ids(oauthRefreshTokens)).toEqual(['r-live']);
    expect(await ids(oauthAuthCodes)).toEqual(['a-live-consumed']);
    expect(await ids(oauthDeviceCodes)).toEqual(['d-live']);
  });

  it('cannot orphan a live successor: a rotated chain expires as a unit', async () => {
    // OAuthRepository.refresh clamps each successor to `min(ancestor.expiresAt, instance cap)`, so a
    // rotated token can never outlive the token it came from. That is what makes deleting an EXPIRED
    // ancestor safe for reuse-detection: by the time one is swept, its whole chain is expired too.
    const db = await makeTestDb();
    await seedUser(db);
    await seedProject(db);
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const grant = { clientId: 'c1', userId: 'u1', projectId: 'p1', role: 'owner' as const, scope: ['content:read' as const] };

    await db.insert(oauthRefreshTokens).values([
      { id: 'r1', ...grant, expiresAt: past, rotatedTo: 'r2', createdAt: past },
      { id: 'r2', ...grant, expiresAt: past, rotatedTo: 'r3', createdAt: past },
      { id: 'r3', ...grant, expiresAt: past, createdAt: past },
    ]);

    await sweepExpiredAuthRows(db, now);

    expect(await db.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens)).toEqual([]);
  });
});

describe('reapUnusedOAuthClients', () => {
  it('drops only long-idle, unreferenced registrations', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    await seedProject(db);
    const now = new Date();
    const old = new Date(now.getTime() - (OAUTH_CLIENT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const grant = { userId: 'u1', projectId: 'p1', role: 'owner' as const, scope: ['content:read' as const] };

    await db.insert(oauthClients).values([
      { id: 'c-idle', name: 'stale', redirectUris: ['http://127.0.0.1/cb'], createdAt: old },
      { id: 'c-granted', name: 'has a session', redirectUris: ['http://127.0.0.1/cb'], createdAt: old },
      { id: 'c-authorizing', name: 'mid-flow', redirectUris: ['http://127.0.0.1/cb'], createdAt: old },
      { id: 'c-polling', name: 'device flow', redirectUris: ['http://127.0.0.1/cb'], createdAt: old },
      { id: 'c-fresh', name: 'just registered', redirectUris: ['http://127.0.0.1/cb'], createdAt: recent },
    ]);
    await db.insert(oauthRefreshTokens).values({ id: 'r1', clientId: 'c-granted', ...grant, expiresAt: new Date(now.getTime() + 60_000), createdAt: now });
    await db.insert(oauthAuthCodes).values({ id: 'a1', clientId: 'c-authorizing', ...grant, redirectUri: 'http://127.0.0.1/cb', codeChallenge: 'x', expiresAt: new Date(now.getTime() + 60_000), createdAt: now });
    await db.insert(oauthDeviceCodes).values({ id: 'd1', userCode: 'AAAA', clientId: 'c-polling', scope: [], status: 'pending', expiresAt: new Date(now.getTime() + 60_000), createdAt: now });

    await reapUnusedOAuthClients(db, now);

    expect((await db.select({ id: oauthClients.id }).from(oauthClients)).map((r) => r.id).sort()).toEqual([
      'c-authorizing',
      'c-fresh',
      'c-granted',
      'c-polling',
    ]);
  });

  it('is a safe no-op on an empty instance', async () => {
    const db = await makeTestDb();
    await expect(reapUnusedOAuthClients(db)).resolves.toBeUndefined();
  });
});

describe('reapDeadPats', () => {
  it('drops PATs dead longer than the retention window, keeps recently-dead and live ones', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    await seedProject(db);
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const longDead = new Date(now.getTime() - (DEAD_PAT_RETENTION_DAYS + 1) * day);
    const recentlyDead = new Date(now.getTime() - 30 * day);
    const future = new Date(now.getTime() + 365 * day);
    const pat = (id: string, extra: Partial<{ expiresAt: Date; revokedAt: Date | null; source: 'pat' | 'oauth' }>) => ({
      id,
      projectId: 'p1',
      name: id,
      role: 'owner' as const,
      capabilities: [],
      tokenHash: `hash-${id}`,
      tokenPrefix: `swk_${id}`,
      expiresAt: future,
      revokedAt: null,
      createdBy: 'u1',
      source: 'pat' as const,
      createdAt: longDead,
      ...extra,
    });

    await db.insert(apiKeys).values([
      pat('expired-long-ago', { expiresAt: longDead }),
      pat('expired-recently', { expiresAt: recentlyDead }), // still worth SEEING, so still listed
      pat('revoked-long-ago', { revokedAt: longDead }), // dead by revocation, expiry still in the future
      pat('revoked-recently', { revokedAt: recentlyDead }),
      pat('live', {}),
      // An OAuth access token expired long ago is sweepExpiredAuthRows' business, not this one's —
      // but it must not be left behind by a function that only claims to touch PATs either.
      pat('oauth-expired', { source: 'oauth', expiresAt: longDead }),
    ]);

    await reapDeadPats(db, now);

    expect((await db.select({ id: apiKeys.id }).from(apiKeys)).map((r) => r.id).sort()).toEqual([
      'expired-recently',
      'live',
      'oauth-expired',
      'revoked-recently',
    ]);
  });

  it('is a safe no-op on an empty instance', async () => {
    const db = await makeTestDb();
    await expect(reapDeadPats(db)).resolves.toBeUndefined();
  });
});
