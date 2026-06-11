import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { sweepExpiredAuthRows } from '../src/repo/maintenance.js';
import { mfaLoginTickets, sessions, users, webauthnChallenges } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

async function seedUser(db: Database): Promise<void> {
  await db.insert(users).values({ id: 'u1', email: 'a@b.co', passwordHash: 'x', createdAt: new Date() });
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
});
