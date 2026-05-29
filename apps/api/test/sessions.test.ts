import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { createSession, revokeSession, validateSession } from '../src/auth/sessions.js';
import { users } from '../src/db/schema.js';
import type { Database } from '../src/db/client.js';

async function seedUser(db: Database): Promise<void> {
  await db.insert(users).values({
    id: 'u1',
    email: 'a@b.co',
    passwordHash: 'x',
    createdAt: new Date(),
  });
}

describe('sessions', () => {
  it('creates a session and validates its token to the user', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    const { token } = await createSession(db, 'u1');
    expect(await validateSession(db, token)).toBe('u1');
  });

  it('returns null for an unknown token', async () => {
    const db = await makeTestDb();
    expect(await validateSession(db, 'no-such-token')).toBeNull();
  });

  it('rejects and deletes an expired session', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    const eightDaysAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8);
    const { token } = await createSession(db, 'u1', eightDaysAgo);
    expect(await validateSession(db, token)).toBeNull();
  });

  it('revokes a session (logout)', async () => {
    const db = await makeTestDb();
    await seedUser(db);
    const { token } = await createSession(db, 'u1');
    await revokeSession(db, token);
    expect(await validateSession(db, token)).toBeNull();
  });
});
