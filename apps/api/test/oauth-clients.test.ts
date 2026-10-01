import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import {
  OAuthClientRepository,
  OAuthClientError,
  isAcceptableRedirectUri,
  CLIENT_TOUCH_INTERVAL_MS,
} from '../src/repo/oauth-clients.js';
import { oauthClients, oauthRefreshTokens, projects, users } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let clients: OAuthClientRepository;

beforeEach(async () => {
  db = await makeTestDb();
  clients = new OAuthClientRepository(db);
});

describe('isAcceptableRedirectUri', () => {
  it('accepts https and loopback http; rejects everything else', () => {
    expect(isAcceptableRedirectUri('https://app.example.com/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://127.0.0.1:8976/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://localhost/cb')).toBe(true);
    expect(isAcceptableRedirectUri('http://evil.example.com/cb')).toBe(false); // non-loopback http
    expect(isAcceptableRedirectUri('https://app.example.com/cb#frag')).toBe(false); // fragment
    expect(isAcceptableRedirectUri('ftp://x/y')).toBe(false);
    expect(isAcceptableRedirectUri('not a url')).toBe(false);
    expect(isAcceptableRedirectUri(`https://x/${'a'.repeat(3000)}`)).toBe(false); // too long
    expect(isAcceptableRedirectUri('https://user:pass@app.example.com/cb')).toBe(false); // userinfo
    expect(isAcceptableRedirectUri('https://singlelabel/cb')).toBe(false); // no dot in host
  });
});

describe('OAuthClientRepository', () => {
  it('registers a public client and returns an opaque client_id', async () => {
    const client = await clients.register({ name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/callback'] });
    expect(client.id).toMatch(/^swcid_/);
    expect(client.name).toBe('Claude');
    expect(client.redirectUris).toEqual(['https://claude.ai/api/mcp/callback']);
    const fetched = await clients.get(client.id);
    expect(fetched).toEqual(client);
  });

  it('returns null for an unknown client', async () => {
    expect(await clients.get('swcid_nope')).toBeNull();
  });

  it('rejects a missing/oversized name', async () => {
    await expect(clients.register({ name: '  ', redirectUris: ['https://a/b'] })).rejects.toThrow(OAuthClientError);
    await expect(clients.register({ name: 'x'.repeat(201), redirectUris: ['https://a/b'] })).rejects.toThrow(OAuthClientError);
  });

  it('rejects empty / too-many / invalid redirect URIs', async () => {
    await expect(clients.register({ name: 'A', redirectUris: [] })).rejects.toThrow(OAuthClientError);
    await expect(
      clients.register({ name: 'A', redirectUris: Array.from({ length: 6 }, (_, i) => `https://a/${i}`) }),
    ).rejects.toThrow(OAuthClientError);
    await expect(clients.register({ name: 'A', redirectUris: ['http://evil.example.com/cb'] })).rejects.toThrow(
      OAuthClientError,
    );
  });
});

/** Reads the raw row so the stored `last_used_at` can be asserted directly. */
async function rowOf(db: Database, id: string): Promise<{ createdAt: Date; lastUsedAt: Date | null }> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
  if (!row) throw new Error(`no client row ${id}`);
  return { createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
}

/** Inserts a registration directly, so its age and last-use can be placed anywhere in time. */
async function seedClient(db: Database, id: string, createdAt: Date, lastUsedAt: Date | null = null): Promise<void> {
  await db.insert(oauthClients).values({ id, name: id, redirectUris: ['https://a.example/cb'], createdAt, lastUsedAt });
}

/** A live refresh token pointing at `clientId` — what makes a registration un-evictable. */
async function seedGrant(db: Database, clientId: string, now: Date): Promise<void> {
  await db.insert(users).values({ id: `u-${clientId}`, email: `${clientId}@e.co`, passwordHash: 'x', createdAt: now });
  await db.insert(projects).values({ id: `p-${clientId}`, name: 'P', slug: `p-${clientId}`, createdAt: now });
  await db.insert(oauthRefreshTokens).values({
    id: `r-${clientId}`,
    clientId,
    userId: `u-${clientId}`,
    projectId: `p-${clientId}`,
    role: 'owner',
    scope: ['content:read'],
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
  });
}

describe('OAuthClientRepository.touch', () => {
  it('records last use, and skips the write while the stamp is still fresh', async () => {
    const t0 = new Date('2026-06-01T12:00:00Z');
    const client = await clients.register({ name: 'A', redirectUris: ['https://a.example/cb'] }, t0);
    // A fresh registration has NOT been used yet — null, not created_at, so "never authorized" stays
    // distinguishable from "authorized at registration time".
    expect((await rowOf(db, client.id)).lastUsedAt).toBeNull();

    const t1 = new Date(t0.getTime() + 60 * 60 * 1000);
    await clients.touch(client.id, t1);
    expect((await rowOf(db, client.id)).lastUsedAt).toEqual(t1);

    // Inside the interval: no write. An authorize round-trip must not cost a row write every time.
    await clients.touch(client.id, new Date(t1.getTime() + CLIENT_TOUCH_INTERVAL_MS - 1000));
    expect((await rowOf(db, client.id)).lastUsedAt).toEqual(t1);

    const t2 = new Date(t1.getTime() + CLIENT_TOUCH_INTERVAL_MS + 1000);
    await clients.touch(client.id, t2);
    expect((await rowOf(db, client.id)).lastUsedAt).toEqual(t2);
  });

  it('is a silent no-op for an unknown client', async () => {
    await expect(clients.touch('swcid_nope', new Date())).resolves.toBeUndefined();
  });
});

describe('OAuthClientRepository eviction at the cap', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const daysAgo = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('evicts the least-recently-used unreferenced registration instead of failing', async () => {
    const capped = new OAuthClientRepository(db, { maxTotalClients: 2 });
    await seedClient(db, 'c-stale', daysAgo(90), daysAgo(60));
    await seedClient(db, 'c-active', daysAgo(90), daysAgo(1));

    const fresh = await capped.register({ name: 'New', redirectUris: ['https://new.example/cb'] }, now);

    const ids = (await db.select({ id: oauthClients.id }).from(oauthClients)).map((r) => r.id).sort();
    expect(ids).toEqual([fresh.id, 'c-active'].sort());
  });

  it('ranks a never-used registration by its creation time, so a brand-new one is not evicted first', async () => {
    const capped = new OAuthClientRepository(db, { maxTotalClients: 3 });
    await seedClient(db, 'c-used-recently', daysAgo(100), daysAgo(1));
    await seedClient(db, 'c-never-used-old', daysAgo(50)); // effective last use = 50d ago → the victim
    await seedClient(db, 'c-never-used-new', new Date(now.getTime() - 1000)); // mid-flow, must survive

    const fresh = await capped.register({ name: 'New', redirectUris: ['https://new.example/cb'] }, now);

    const ids = (await db.select({ id: oauthClients.id }).from(oauthClients)).map((r) => r.id).sort();
    expect(ids).toEqual([fresh.id, 'c-used-recently', 'c-never-used-new'].sort());
  });

  it('never evicts a registration something still points at', async () => {
    const capped = new OAuthClientRepository(db, { maxTotalClients: 2 });
    await seedClient(db, 'c-granted', daysAgo(400)); // oldest, but a live grant references it
    await seedGrant(db, 'c-granted', now);
    await seedClient(db, 'c-idle', daysAgo(2));

    const fresh = await capped.register({ name: 'New', redirectUris: ['https://new.example/cb'] }, now);

    const ids = (await db.select({ id: oauthClients.id }).from(oauthClients)).map((r) => r.id).sort();
    expect(ids).toEqual([fresh.id, 'c-granted'].sort()); // the referenced one survived; the idle one went
  });

  it('refuses registration when every row at the cap is still referenced', async () => {
    const capped = new OAuthClientRepository(db, { maxTotalClients: 1 });
    await seedClient(db, 'c-granted', daysAgo(400));
    await seedGrant(db, 'c-granted', now);

    await expect(
      capped.register({ name: 'New', redirectUris: ['https://new.example/cb'] }, now),
    ).rejects.toThrow(OAuthClientError);
    expect(await db.select({ id: oauthClients.id }).from(oauthClients)).toHaveLength(1);
  });
});
