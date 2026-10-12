import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { memberTokenCreations, memberTokenProjects, memberTokens, projects as projectsTable } from '../src/db/schema.js';
import { deleteUserAccount, registerAccount, setPlatformRole } from '../src/repo/accounts.js';
import { DEAD_PAT_RETENTION_DAYS, MEMBER_TOKEN_LEDGER_RETENTION_DAYS, reapDeadPats } from '../src/repo/maintenance.js';
import { MemberTokenRepository } from '../src/repo/member-tokens.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { generateApiToken, generateMemberToken, isApiTokenFormat, isMemberTokenFormat } from '../src/auth/api-keys.js';

const DAY = 24 * 60 * 60 * 1000;

let db: Database;
let repo: MemberTokenRepository;
let projects: ProjectRepository;
let staff: string;
let projectId: string;

/** The fire-and-forget activity write has no handle to await; poll for the row instead. */
async function useRow(tokenId: string, pid: string) {
  for (let i = 0; i < 100; i += 1) {
    const [row] = await db.select().from(memberTokenProjects).where(eq(memberTokenProjects.tokenId, tokenId));
    if (row && row.projectId === pid) return row;
    await new Promise((r) => setTimeout(r, 5));
  }
  return undefined;
}

beforeEach(async () => {
  db = await makeTestDb();
  repo = new MemberTokenRepository(db);
  projects = new ProjectRepository(db);
  staff = (await registerAccount(db, 'dev@agency.test', 'Correct-Horse-9!', { platformRole: 'developer' })).userId;
  projectId = (await projects.create({ name: 'Site', slug: 'site' }, staff)).id;
});

const inAYear = (): Date => new Date(Date.now() + 300 * DAY);

/** A ledger row whose project is gone (rolled back or reaped) — the row outlives it by design. */
async function ledgerRow(tokenId: string, pid: string, at: Date): Promise<void> {
  await db.insert(memberTokenCreations).values({ id: `led-${pid}`, tokenId, projectId: pid, createdAt: at });
}

describe('token shapes', () => {
  it('a member token and a project key never look like one another', () => {
    const member = generateMemberToken().token;
    const key = generateApiToken().token;
    expect(member).toMatch(/^swm_[0-9a-f]{64}$/);
    expect(isMemberTokenFormat(member)).toBe(true);
    expect(isApiTokenFormat(member)).toBe(false);
    expect(isMemberTokenFormat(key)).toBe(false);
  });
});

describe('MemberTokenRepository.create', () => {
  it('refuses a non-staff owner, an empty or unknown capability list, and a bad expiry', async () => {
    const client = (await registerAccount(db, 'client@customer.test', 'Correct-Horse-9!')).userId;
    const ok = { name: 't', capabilities: ['content:read' as const], expiresAt: inAYear() };
    await expect(repo.create(client, ok)).rejects.toThrow('only agency staff can create member tokens');
    await expect(repo.create('no-such-user', ok)).rejects.toThrow('only agency staff can create member tokens');
    await expect(repo.create(staff, { ...ok, capabilities: [] })).rejects.toThrow('at least one capability');
    await expect(repo.create(staff, { ...ok, capabilities: ['root' as never] })).rejects.toThrow('unknown capability: root');
    await expect(repo.create(staff, { ...ok, expiresAt: new Date(Date.now() - 1) })).rejects.toThrow('expiry must be in the future');
    await expect(repo.create(staff, { ...ok, expiresAt: new Date(Date.now() + 400 * DAY) })).rejects.toThrow('maximum token lifetime');
    expect(await db.select().from(memberTokens)).toHaveLength(0);
  });

  it('de-duplicates capabilities and lists newest first, without revoked ones', async () => {
    const a = await repo.create(staff, { name: 'a', capabilities: ['content:read', 'content:read', 'projects:create'], expiresAt: inAYear() }, new Date(Date.now() - 1000));
    const b = await repo.create(staff, { name: 'b', capabilities: ['content:read'], expiresAt: inAYear() });
    expect(a.key.capabilities).toEqual(['content:read', 'projects:create']);
    expect((await repo.list(staff)).map((t) => t.name)).toEqual(['b', 'a']);
    await repo.revoke(staff, b.key.id);
    expect((await repo.list(staff)).map((t) => t.name)).toEqual(['a']);
    expect(await repo.ownerOf(a.key.id)).toBe(staff);
    expect(await repo.ownerOf(b.key.id)).toBeNull();
    expect(await repo.ownerOf('nope')).toBeNull();
  });

  it('keeps a daily project limit only on a token that can create projects, and refuses a nonsensical one', async () => {
    const base = { name: 't', expiresAt: inAYear() };
    const limited = await repo.create(staff, { ...base, capabilities: ['projects:create'], dailyProjectLimit: 3 });
    expect(limited.key.dailyProjectLimit).toBe(3);
    expect((await repo.resolve(limited.token))?.dailyProjectLimit).toBe(3);
    // Unset → null: "whatever the instance allows", decided when the token is used.
    expect((await repo.create(staff, { ...base, capabilities: ['projects:create'] })).key.dailyProjectLimit).toBeNull();
    // Meaningless without the capability, so it is not stored.
    expect((await repo.create(staff, { ...base, capabilities: ['content:read'], dailyProjectLimit: 3 })).key.dailyProjectLimit).toBeNull();
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      await expect(repo.create(staff, { ...base, capabilities: ['projects:create'], dailyProjectLimit: bad })).rejects.toThrow('whole number of at least 1');
    }
  });

  it('counts an account’s working tokens, and revoking them all says how many that was', async () => {
    await repo.create(staff, { name: 'a', capabilities: ['content:read'], expiresAt: inAYear() });
    const b = await repo.create(staff, { name: 'b', capabilities: ['content:read'], expiresAt: inAYear() });
    await repo.create(staff, { name: 'expired', capabilities: ['content:read'], expiresAt: new Date(Date.now() + 1000) }, new Date(Date.now() - DAY));
    expect(await repo.countLive(staff, new Date(Date.now() + 2000))).toBe(2);
    await repo.revoke(staff, b.key.id);
    expect(await repo.countLive(staff, new Date(Date.now() + 2000))).toBe(1);
    // Every UNREVOKED row is revoked, the expired one included — it is dead either way.
    expect(await repo.revokeAllForUser(staff)).toBe(2);
    expect(await repo.revokeAllForUser(staff)).toBe(0);
    expect(await repo.countLive(staff)).toBe(0);
  });
});

describe('MemberTokenRepository.listAll — the admin view', () => {
  it('lists every account’s tokens with owner, status and activity — working ones first, never a secret', async () => {
    const admin = (await registerAccount(db, 'admin@agency.test', 'Correct-Horse-9!', { platformRole: 'admin' })).userId;
    const now = new Date();
    const fleet = await repo.create(staff, { name: 'fleet', capabilities: ['projects:create'], expiresAt: inAYear(), dailyProjectLimit: 4 }, new Date(now.getTime() - 3000));
    const idle = await repo.create(admin, { name: 'idle', capabilities: ['content:read'], expiresAt: inAYear() }, new Date(now.getTime() - 2000));
    const lapsed = await repo.create(staff, { name: 'lapsed', capabilities: ['content:read'], expiresAt: new Date(now.getTime() - 1000) }, new Date(now.getTime() - DAY));
    const cut = await repo.create(admin, { name: 'cut', capabilities: ['content:read'], expiresAt: inAYear() }, new Date(now.getTime() - 1000));
    await repo.revoke(admin, cut.key.id);
    // Two creations today and one two days ago: only today's count against the limit.
    await repo.recordProjectCreated(fleet.key.id, projectId, now);
    await ledgerRow(fleet.key.id, 'gone-1', now);
    await ledgerRow(fleet.key.id, 'gone-2', new Date(now.getTime() - 2 * DAY));

    const all = await repo.listAll(now);
    expect(all.map((t) => [t.name, t.status])).toEqual([
      // Active first; within a group, the most recently active (never used → when it was made).
      ['idle', 'active'],
      ['fleet', 'active'],
      ['cut', 'revoked'],
      ['lapsed', 'expired'],
    ]);
    const row = all.find((t) => t.id === fleet.key.id);
    expect(row).toMatchObject({
      owner: { userId: staff, email: 'dev@agency.test', role: 'developer' },
      dailyProjectLimit: 4,
      projectsUsed: 1,
      projectsCreatedToday: 2,
    });
    expect(all.find((t) => t.id === idle.key.id)).toMatchObject({ owner: { role: 'admin' }, projectsUsed: 0, projectsCreatedToday: 0 });
    expect(all.find((t) => t.id === lapsed.key.id)?.revokedAt).toBeNull();
    expect(JSON.stringify(all)).not.toContain('tokenHash');
    expect(JSON.stringify(all)).not.toContain(fleet.token);

    // An owner who is no longer staff: the token cannot authenticate, and the list says why.
    await setPlatformRole(db, staff, null);
    const after = await repo.listAll(now);
    expect(after.find((t) => t.id === fleet.key.id)).toMatchObject({ status: 'suspended', owner: { role: null } });
    expect(after.find((t) => t.id === lapsed.key.id)?.status).toBe('expired');
  });
});

describe('MemberTokenRepository.resolve', () => {
  it('resolves a live token to its owner and stamps its last use', async () => {
    const { token, key } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: inAYear() });
    expect(await repo.resolve(token)).toEqual({ tokenId: key.id, userId: staff, capabilities: ['content:read'], dailyProjectLimit: null });
    for (let i = 0; i < 100; i += 1) {
      const [row] = await db.select().from(memberTokens);
      if (row?.lastUsedAt) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await db.select().from(memberTokens))[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('returns null for a project key, an unknown token, a revoked one, an expired one, and a non-staff owner', async () => {
    const { token, key } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: new Date(Date.now() + DAY) });
    expect(await repo.resolve(generateApiToken().token)).toBeNull();
    expect(await repo.resolve(generateMemberToken().token)).toBeNull();
    expect(await repo.resolve(token, new Date(Date.now() + 2 * DAY))).toBeNull();
    // `expiresAt == now` is already expired, as it is for sessions and project keys.
    expect(await repo.resolve(token, key.expiresAt)).toBeNull();

    await setPlatformRole(db, staff, null);
    expect(await repo.resolve(token)).toBeNull();
    await setPlatformRole(db, staff, 'admin');
    expect(await repo.resolve(token)).not.toBeNull();

    await repo.revokeAllForUser(staff);
    expect(await repo.resolve(token)).toBeNull();
  });
});

describe('per-project activity', () => {
  it('writes a use once, then at most once a minute — and counts only CREATED projects', async () => {
    const { key } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: inAYear() });
    const t0 = new Date('2026-10-01T10:00:00Z');
    repo.recordUse(key.id, projectId, t0);
    expect((await useRow(key.id, projectId))?.lastUsedAt).toEqual(t0);

    // 30 seconds later: skipped. 61 seconds later: written, and the first-use time is kept.
    repo.recordUse(key.id, projectId, new Date(t0.getTime() + 30_000));
    await new Promise((r) => setTimeout(r, 30));
    expect((await useRow(key.id, projectId))?.lastUsedAt).toEqual(t0);
    const later = new Date(t0.getTime() + 61_000);
    repo.recordUse(key.id, projectId, later);
    for (let i = 0; i < 100; i += 1) {
      if ((await useRow(key.id, projectId))?.lastUsedAt.getTime() === later.getTime()) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const row = await useRow(key.id, projectId);
    expect(row?.lastUsedAt).toEqual(later);
    expect(row?.firstUsedAt).toEqual(t0);

    // Merely using a project is not creating it.
    expect(await repo.countProjectsCreatedSince(key.id, new Date(0))).toBe(0);
    const made = (await projects.create({ name: 'New', slug: 'new' }, staff)).id;
    const now = new Date();
    await repo.recordProjectCreated(key.id, made, now);
    await repo.recordProjectCreated(key.id, projectId, new Date(now.getTime() - 2 * DAY));
    expect(await repo.countProjectsCreatedSince(key.id, new Date(now.getTime() - DAY))).toBe(1);
    expect(await repo.countProjectsCreatedSince(key.id, new Date(0))).toBe(2);
    // The new project lists the token as connected at once, with no request needed.
    expect((await repo.listConnectionsForProject(made, now)).map((c) => c.tokenId)).toEqual([key.id]);
  });

  it('★ a creation still counts after its project is rolled back — a failed import is not refunded', async () => {
    const { key } = await repo.create(staff, { name: 't', capabilities: ['projects:create'], expiresAt: inAYear() });
    const doomed = (await projects.create({ name: 'Doomed', slug: 'doomed' }, staff)).id;
    await repo.recordProjectCreated(key.id, doomed);
    // What the import and duplicate routes do when the work after the create fails.
    await projects.remove(doomed);

    expect(await repo.countProjectsCreatedSince(key.id, new Date(Date.now() - DAY))).toBe(1);
    // The ledger still says who made it; the per-project activity row went with the project.
    expect((await db.select().from(memberTokenCreations)).map((r) => r.projectId)).toEqual([doomed]);
    expect(await db.select().from(memberTokenProjects)).toHaveLength(0);
  });

  it('★ a failed activity write is retried by the next request rather than remembered as done', async () => {
    const { key } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: inAYear() });
    const t0 = new Date('2026-10-01T10:00:00Z');
    // No such project yet → the FK rejects the insert.
    repo.recordUse(key.id, 'late-project', t0);
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.select().from(memberTokenProjects)).toHaveLength(0);

    // The SAME (token, project) pair at the SAME instant: inside the one-a-minute window, so this is
    // skipped unless the failure released its claim.
    await db.insert(projectsTable).values({ id: 'late-project', name: 'Late', slug: 'late', createdAt: t0 });
    repo.recordUse(key.id, 'late-project', t0);
    expect(await useRow(key.id, 'late-project')).toBeDefined();
  });

  it('stamps a token’s last use at most once a minute, not on every request', async () => {
    const { token } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: inAYear() });
    const stamp = async (): Promise<number | undefined> => (await db.select().from(memberTokens))[0]?.lastUsedAt?.getTime();
    const t0 = new Date();
    await repo.resolve(token, t0);
    for (let i = 0; i < 100 && (await stamp()) === undefined; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(await stamp()).toBe(t0.getTime());

    await repo.resolve(token, new Date(t0.getTime() + 30_000));
    await new Promise((r) => setTimeout(r, 30));
    expect(await stamp()).toBe(t0.getTime());

    const later = new Date(t0.getTime() + 61_000);
    await repo.resolve(token, later);
    for (let i = 0; i < 100 && (await stamp()) !== later.getTime(); i += 1) await new Promise((r) => setTimeout(r, 5));
    expect(await stamp()).toBe(later.getTime());
  });

  it('lists live connections for a project, most recent first — never revoked, expired or ex-staff ones', async () => {
    const other = (await registerAccount(db, 'second@agency.test', 'Correct-Horse-9!', { platformRole: 'developer' })).userId;
    const now = new Date();
    const live = await repo.create(staff, { name: 'live', capabilities: ['content:read'], expiresAt: inAYear() });
    const newer = await repo.create(other, { name: 'newer', capabilities: ['content:write'], expiresAt: inAYear() });
    const revoked = await repo.create(staff, { name: 'revoked', capabilities: ['content:read'], expiresAt: inAYear() });
    const expired = await repo.create(staff, { name: 'expired', capabilities: ['content:read'], expiresAt: new Date(now.getTime() - DAY) }, new Date(now.getTime() - 2 * DAY));
    await repo.recordProjectCreated(live.key.id, projectId, new Date(now.getTime() - 60_000));
    await repo.recordProjectCreated(newer.key.id, projectId, now);
    await repo.recordProjectCreated(revoked.key.id, projectId, now);
    await repo.recordProjectCreated(expired.key.id, projectId, now);
    await repo.revoke(staff, revoked.key.id);

    const list = await repo.listConnectionsForProject(projectId, now);
    expect(list.map((c) => c.name)).toEqual(['newer', 'live']);
    expect(list[0]).toMatchObject({ tokenId: newer.key.id, userId: other, ownerEmail: 'second@agency.test', capabilities: ['content:write'] });
    expect(list[0]).not.toHaveProperty('ownerRole');

    await setPlatformRole(db, other, null);
    expect((await repo.listConnectionsForProject(projectId, now)).map((c) => c.name)).toEqual(['live']);
    expect(await repo.listConnectionsForProject('elsewhere', now)).toEqual([]);
  });
});

describe('cleanup — nothing a member token leaves behind may block a delete', () => {
  it('a project a member token acted on (or created) can still be reaped', async () => {
    const { key } = await repo.create(staff, { name: 't', capabilities: ['projects:create'], expiresAt: inAYear() });
    await repo.recordProjectCreated(key.id, projectId);
    // Without the delete in ProjectRepository.remove() this throws SQLITE_CONSTRAINT_FOREIGNKEY and
    // the project can never be purged.
    await expect(projects.remove(projectId)).resolves.toBeUndefined();
    expect(await db.select().from(memberTokenProjects)).toHaveLength(0);
    expect(await db.select().from(memberTokens)).toHaveLength(1); // the token itself is the member's
    expect(await db.select().from(memberTokenCreations)).toHaveLength(1); // and so is its record
  });

  it('an account that once held member tokens can still be deleted', async () => {
    const { key } = await repo.create(staff, { name: 't', capabilities: ['content:read'], expiresAt: inAYear() });
    await repo.recordProjectCreated(key.id, projectId);
    const bystander = (await registerAccount(db, 'second@agency.test', 'Correct-Horse-9!', { platformRole: 'developer' })).userId;
    await repo.create(bystander, { name: 'theirs', capabilities: ['content:read'], expiresAt: inAYear() });
    // Demoted to a client first: deleteUserAccount is only ever called for non-staff.
    await setPlatformRole(db, staff, null);

    await expect(deleteUserAccount(db, staff)).resolves.toBeUndefined();
    expect(await db.select().from(memberTokenProjects)).toHaveLength(0);
    expect(await db.select().from(memberTokenCreations)).toHaveLength(0);
    expect((await db.select().from(memberTokens)).map((t) => t.name)).toEqual(['theirs']);
  });

  it('dead tokens are reaped after the retention window, with their activity rows; live and recently-dead ones stay', async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - (DEAD_PAT_RETENTION_DAYS + 30) * DAY);
    const mk = (name: string, expiresAt: Date, mintedAt: Date) => repo.create(staff, { name, capabilities: ['content:read'], expiresAt }, mintedAt);
    const live = await mk('live', inAYear(), now);
    const longExpired = await mk('long-expired', new Date(now.getTime() - (DEAD_PAT_RETENTION_DAYS + 1) * DAY), longAgo);
    const justExpired = await mk('just-expired', new Date(now.getTime() - DAY), longAgo);
    const longRevoked = await mk('long-revoked', inAYear(), now);
    const justRevoked = await mk('just-revoked', inAYear(), now);
    await repo.revoke(staff, longRevoked.key.id, new Date(now.getTime() - (DEAD_PAT_RETENTION_DAYS + 1) * DAY));
    await repo.revoke(staff, justRevoked.key.id, new Date(now.getTime() - DAY));
    for (const t of [live, longExpired, justExpired, longRevoked, justRevoked]) await repo.recordProjectCreated(t.key.id, projectId, now);

    await reapDeadPats(db, now);

    const left = (await db.select().from(memberTokens)).map((t) => t.name).sort();
    expect(left).toEqual(['just-expired', 'just-revoked', 'live']);
    const kept = [live.key.id, justExpired.key.id, justRevoked.key.id].sort();
    expect((await db.select().from(memberTokenProjects)).map((r) => r.tokenId).sort()).toEqual(kept);
    expect((await db.select().from(memberTokenCreations)).map((r) => r.tokenId).sort()).toEqual(kept);
  });

  it('★ a LIVING token’s creation ledger is pruned once nothing reads it — the daily count is untouched', async () => {
    const now = new Date();
    const { key } = await repo.create(staff, { name: 'busy', capabilities: ['projects:create'], expiresAt: inAYear() }, now);
    const old = new Date(now.getTime() - (MEMBER_TOKEN_LEDGER_RETENTION_DAYS + 1) * DAY);
    const recent = new Date(now.getTime() - (MEMBER_TOKEN_LEDGER_RETENTION_DAYS - 1) * DAY);
    const today = new Date(now.getTime() - 60_000);
    await ledgerRow(key.id, 'p-old', old);
    await ledgerRow(key.id, 'p-recent', recent);
    await repo.recordProjectCreated(key.id, projectId, today);

    await reapDeadPats(db, now);

    expect((await db.select().from(memberTokenCreations)).map((r) => r.projectId).sort()).toEqual([projectId, 'p-recent'].sort());
    // The cap reads back one day, far inside what is kept.
    expect(await repo.countProjectsCreatedSince(key.id, new Date(now.getTime() - DAY))).toBe(1);
    // The token and its per-project activity are not housekeeping's to touch while it lives.
    expect(await db.select().from(memberTokens)).toHaveLength(1);
    expect((await db.select().from(memberTokenProjects)).length).toBeGreaterThan(0);
  });
});
