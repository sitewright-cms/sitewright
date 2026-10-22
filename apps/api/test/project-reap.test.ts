import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { createClient } from '@libsql/client';
import { makeTestDb } from './helpers.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { RankRepository } from '../src/rank/repo.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { registerAccount } from '../src/repo/accounts.js';
import { SubmissionRepository } from '../src/repo/submissions.js';
import { agentGrants, rankCharges, shopCatalog, shopStock, shopTransactions, shopFiltered, webmasterRemovals } from '../src/db/schema.js';

// REAP = the permanent delete behind the admin "deleted projects" purge. There is no ON DELETE CASCADE
// in this schema, so `ProjectRepository.remove()` must clear every table holding an FK to `projects`
// itself. A table missed there does not fail loudly at write time — it fails only when someone tries to
// purge, with SQLITE_CONSTRAINT_FOREIGNKEY, and that project can then NEVER be removed. `agent_grants`
// was missed exactly this way: five projects on the shared instance became permanently un-purgeable.

/** Every table with an FK to `projects`, read from the migrated schema itself. */
async function projectFkTables(db: Awaited<ReturnType<typeof makeTestDb>>): Promise<string[]> {
  const tables = (await db.all(
    sql`select name from sqlite_master where type='table' and name not like 'sqlite_%'`,
  )) as Array<{ name: string }>;
  const referencing: string[] = [];
  for (const { name } of tables) {
    const fks = (await db.all(sql`select "table" as target from pragma_foreign_key_list(${name})`)) as Array<{ target: string }>;
    if (fks.some((f) => f.target === 'projects')) referencing.push(name);
  }
  return referencing.sort();
}

describe('project reap', () => {
  // The drift guard: the FK children `remove()` is responsible for clearing. (`remove()` also clears
  // `ai_usage` and `oauth_device_codes`, which carry no FK — they are cleanup, not a constraint, so they
  // are not listed here.) Adding a table that references `projects` fails this test by name, forcing the
  // author to add BOTH a `tx.delete(...)` in remove() and an entry here — rather than shipping a project
  // that silently cannot ever be purged.
  const REAPED_TABLES = [
    'agent_grants',
    'api_keys',
    'content',
    'content_revisions',
    'form_filtered',
    'form_submissions',
    'invites',
    'member_token_projects',
    'oauth_auth_codes',
    'oauth_refresh_tokens',
    'project_domains',
    'project_members',
    'project_releases',
    'rank_checks',
    'rank_keywords',
    'rank_projects',
    'shop_catalog',
    'shop_filtered',
    'shop_stock',
    'shop_transactions',
    'webmaster_sites',
  ].sort();

  it('remove() clears EVERY table that carries an FK to projects', async () => {
    const db = await makeTestDb();
    const referencing = await projectFkTables(db);
    // If this fails, a new table references `projects` — add a `tx.delete(...)` for it in
    // ProjectRepository.remove() and list it here. Do not just update the list.
    expect(referencing).toEqual(REAPED_TABLES);
  });

  it('reaps a project that has taken PAYMENTS (four more tables of the same trap)', async () => {
    // shop_catalog / shop_stock / shop_transactions / shop_filtered all carry an FK to projects. The
    // drift guard above named them the moment they were added; this proves the deletes actually work,
    // because a missed one makes the project permanently un-purgeable rather than merely untidy.
    const db = await makeTestDb();
    const projects = new ProjectRepository(db);
    const project = await projects.create({ name: 'Shop', slug: 'shop-reap' });
    const now = new Date();
    await db.insert(shopCatalog).values({ projectId: project.id, mode: 'live', currency: 'EUR', items: {}, digest: 'd', publishedAt: now });
    await db.insert(shopStock).values({ projectId: project.id, sku: 'mug', onStock: 1, sold: 0, reserved: 0, authoredAtPublish: 1, updatedAt: now });
    await db.insert(shopTransactions).values({
      id: 'txn_reap',
      projectId: project.id,
      channelKey: 'pay',
      gatewayId: 'mock',
      mode: 'test',
      currency: 'EUR',
      subtotalMinor: 100,
      totalMinor: 100,
      lines: [],
      buyer: {},
      catalogDigest: 'd',
      publicToken: 'tok_reap_aaaaaaaaaaaaaaaa',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(shopFiltered).values({ projectId: project.id, channelKey: 'pay', reason: 'honeypot', count: 1, lastAt: now });

    await expect(projects.remove(project.id)).resolves.toBeUndefined();
    expect(await db.select().from(shopCatalog)).toHaveLength(0);
    expect(await db.select().from(shopStock)).toHaveLength(0);
    expect(await db.select().from(shopTransactions)).toHaveLength(0);
    expect(await db.select().from(shopFiltered)).toHaveLength(0);
  });

  it('reaps a project whose forms have FILTERED counts (the same trap, caught by the guard above)', async () => {
    // form_filtered arrived with the spam counters and carries an FK to projects, but was not cleared
    // in remove() — so any project whose forms had ever dropped a bot was permanently un-purgeable,
    // exactly as agent_grants once was. The drift guard named the table; this proves the fix.
    const db = await makeTestDb();
    const projects = new ProjectRepository(db);
    const project = await projects.create({ name: 'Trapped', slug: 'trapped' });
    await new SubmissionRepository(db).recordFiltered(project.id, 'contact', 'honeypot');

    await expect(projects.remove(project.id)).resolves.toBeUndefined();
    await expect(projects.get(project.id)).rejects.toThrow(/not found/i);
    const left = (await db.all(sql`select count(*) as n from form_filtered where project_id = ${project.id}`)) as Array<{ n: number }>;
    expect(Number(left[0]?.n ?? 0)).toBe(0);
  });

  it('reaps a project that holds an agent grant (the FK that made projects un-purgeable)', async () => {
    const db = await makeTestDb();
    const projects = new ProjectRepository(db);
    const { userId } = await registerAccount(db, 'grant-owner@test.example', 'Correct-Horse-9!');
    const project = await projects.create({ name: 'Granted', slug: 'granted' });

    const now = new Date();
    await db.insert(agentGrants).values({
      id: 'grant-1',
      userId,
      projectId: project.id,
      capabilities: ['content:read'],
      autonomy: 'full',
      createdAt: now,
      updatedAt: now,
    });

    // Before the fix this threw SQLITE_CONSTRAINT_FOREIGNKEY and the project stayed forever.
    await expect(projects.remove(project.id)).resolves.toBeUndefined();
    await expect(projects.get(project.id)).rejects.toThrow(/not found/i);
    const left = (await db.all(sql`select count(*) as n from agent_grants where project_id = ${project.id}`)) as Array<{ n: number }>;
    expect(Number(left[0]?.n ?? 0)).toBe(0);
  });

  it('leaves what must OUTLIVE the project: what its rank checks cost, and the site removals still queued', async () => {
    // Both tables carry a project id on purpose WITHOUT a foreign key, so the guard above does not list them: money
    // already spent stays in the month's budget, and a site still registered at Google or Bing stays on record until
    // the hourly sweep removes it. Clearing them here is the defect they exist to prevent.
    const db = await makeTestDb();
    const projects = new ProjectRepository(db);
    const project = await projects.create({ name: 'Outlived', slug: 'outlived' });
    const rank = new RankRepository(db);
    await rank.putProject(project.id, { domain: 'plumbers.na', includeSubdomains: true, schedule: 'daily', depth: 100 });
    await rank.addKeywords(project.id, { keywords: ['a'], engine: 'google', device: 'desktop', location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' });
    const [k] = await rank.listKeywords(project.id);
    const now = new Date();
    await rank.claim({ ...k!, depth: 100, domain: 'plumbers.na', includeSubdomains: true }, now.toISOString().slice(0, 10), 'dataforseo', 0.006, now);
    await db.insert(webmasterRemovals).values({ id: 'r1', projectId: project.id, service: 'bing', siteUrl: 'https://outlived.example/', account: 'acc', attempts: 1, nextAt: now, createdAt: now });

    await projects.remove(project.id);
    expect(await db.select().from(rankCharges)).toHaveLength(1);
    expect(await rank.spentMicrosInMonth(now)).toBe(6000);
    expect(await db.select().from(webmasterRemovals)).toHaveLength(1);
  });

  // The audit asked whether these guards rest on anything: `createDb` never sets PRAGMA foreign_keys. They do — libsql
  // turns foreign keys ON by default for every connection it opens, and its pool opens more than the one `createDb`
  // ran its pragmas on. This pins that default, so a driver change cannot quietly turn every FK in the schema off.
  it('foreign keys are enforced on any connection to the database, not just the first', async () => {
    const file = join(tmpdir(), `sw-fk-${randomUUID()}.db`);
    const { db, client } = await createDb(`file:${file}`);
    const fresh = createClient({ url: `file:${file}` }); // none of createDb's pragmas: like a connection the pool adds
    try {
      await runMigrations(db);
      expect((await fresh.execute('PRAGMA foreign_keys')).rows[0]).toMatchObject({ foreign_keys: 1 });
      await expect(
        fresh.execute({ sql: "INSERT INTO rank_projects (project_id, domain, include_subdomains, schedule, depth, updated_at) VALUES ('no-such-project', 'x.test', 0, 'daily', 10, 0)", args: [] }),
      ).rejects.toThrow(/FOREIGN KEY/);
    } finally {
      fresh.close();
      client.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    }
  });
});
