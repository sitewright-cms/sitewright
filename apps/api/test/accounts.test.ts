import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './helpers.js';
import {
  getMembership,
  listOrgsForUser,
  login,
  registerAccount,
  tenantContext,
} from '../src/repo/accounts.js';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
beforeEach(async () => {
  db = await makeTestDb();
});

describe('registerAccount', () => {
  it('creates a user, org, and owner membership', async () => {
    const { userId, orgId } = await registerAccount(db, 'A@Acme.test', 'pw-secret', 'Acme');
    expect(await getMembership(db, userId, orgId)).toBe('owner');
    const orgs = await listOrgsForUser(db, userId);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe('Acme');
  });

  it('rejects a duplicate email (case-insensitive)', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    await expect(registerAccount(db, 'A@ACME.test', 'pw-secret', 'Acme2')).rejects.toThrow(
      ConflictError,
    );
  });

  it('derives a unique org slug when names collide', async () => {
    const a = await registerAccount(db, 'a@x.test', 'pw-secret', 'Acme');
    const b = await registerAccount(db, 'b@x.test', 'pw-secret', 'Acme');
    const slugA = (await listOrgsForUser(db, a.userId))[0]?.slug;
    const slugB = (await listOrgsForUser(db, b.userId))[0]?.slug;
    expect(slugA).toBe('acme');
    expect(slugB).toBe('acme-2');
  });
});

describe('login', () => {
  it('returns the userId for correct credentials', async () => {
    const { userId } = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    expect(await login(db, 'A@acme.test', 'pw-secret')).toBe(userId);
  });

  it('throws on a wrong password', async () => {
    await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    await expect(login(db, 'a@acme.test', 'wrong')).rejects.toThrow(UnauthorizedError);
  });

  it('throws on an unknown email', async () => {
    await expect(login(db, 'nobody@x.test', 'pw')).rejects.toThrow(UnauthorizedError);
  });
});

describe('tenantContext', () => {
  it('builds a context for a member', async () => {
    const { userId, orgId } = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    expect(await tenantContext(db, userId, orgId)).toEqual({ userId, orgId, role: 'owner' });
  });

  it('throws Forbidden for a non-member', async () => {
    const a = await registerAccount(db, 'a@acme.test', 'pw-secret', 'Acme');
    const b = await registerAccount(db, 'b@globex.test', 'pw-secret', 'Globex');
    await expect(tenantContext(db, a.userId, b.orgId)).rejects.toThrow(ForbiddenError);
  });
});
