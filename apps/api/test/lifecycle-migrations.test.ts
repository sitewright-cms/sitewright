import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, runMigrations, type DbHandle } from '../src/db/client.js';
import { rankChecks, rankCharges, webmasterRemovals } from '../src/db/schema.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { RankRepository } from '../src/rank/repo.js';

/**
 * The two lifecycle migrations, each applied to a database migrated up to the one before it — as an upgrading
 * instance meets them.
 *
 * 0041 moves the month's rank tracking spend into `rank_charges`. An instance upgrading mid-month must keep what it
 * already spent, or the budget would start the month again at zero: every existing check is booked as a charge in the
 * UTC month it was posted in — what the budget counted before.
 *
 * 0042 adds the queue of site removals to try again (`webmaster_removals`), one entry per site and account.
 */

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

let dir: string | undefined;
let handle: DbHandle | undefined;
afterEach(async () => {
  handle?.client.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  handle = undefined;
});

/** A database migrated up to and including migration `last`; the rest are applied by `runMigrations`. */
async function migratedUpTo(last: number): Promise<DbHandle['db']> {
  dir = await mkdtemp(join(tmpdir(), 'sw-mig-'));
  const before = join(dir, 'drizzle');
  await cp(MIGRATIONS, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((e) => e.idx <= last);
  await writeFile(journalPath, JSON.stringify(journal));
  handle = await createDb(`file:${join(dir, 'db.sqlite')}`);
  await migrate(handle.db, { migrationsFolder: before });
  return handle.db;
}

describe('migration 0041 (rank charges)', () => {
  it('books every existing check as a charge in the month it was posted', async () => {
    const db = await migratedUpTo(40);

    const projectId = (await new ProjectRepository(db).create({ name: 'Old', slug: 'old-checks' })).id;
    const rank = new RankRepository(db);
    await rank.putProject(projectId, { domain: 'plumbers.na', includeSubdomains: true, schedule: 'daily', depth: 100 });
    await rank.addKeywords(projectId, { keywords: ['a'], engine: 'google', device: 'desktop', location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' });
    const [k] = await rank.listKeywords(projectId);
    const check = (id: string, day: string, postedAt: string, costMicros: number) => ({
      id,
      keywordId: k!.id,
      projectId,
      day,
      provider: 'dataforseo',
      status: 'done' as const,
      domain: 'plumbers.na',
      includeSubdomains: true,
      depth: 100,
      costMicros,
      postedAt: new Date(postedAt),
    });
    await db.insert(rankChecks).values([
      check('september', '2026-09-30', '2026-09-30T23:59:00Z', 6000),
      check('october-1', '2026-10-01', '2026-10-01T00:01:00Z', 5000),
      check('october-2', '2026-10-02', '2026-10-02T08:00:00Z', 4000),
    ]);

    await runMigrations(db);

    const charges = await db.select().from(rankCharges);
    expect(charges.sort((a, b) => a.checkId.localeCompare(b.checkId))).toEqual([
      { checkId: 'october-1', month: '2026-10', costMicros: 5000 },
      { checkId: 'october-2', month: '2026-10', costMicros: 4000 },
      { checkId: 'september', month: '2026-09', costMicros: 6000 },
    ]);
    expect(await rank.spentMicrosInMonth(new Date('2026-10-15T00:00:00Z'))).toBe(9000);
    expect(await rank.spentMicrosInMonth(new Date('2026-09-15T00:00:00Z'))).toBe(6000);
  });
});

describe('migration 0042 (site removals to try again)', () => {
  it('adds the queue, one entry per site and account', async () => {
    const db = await migratedUpTo(41);
    const tables = async () => ((await db.all(sql`select name from sqlite_master where type = 'table'`)) as Array<{ name: string }>).map((t) => t.name);
    expect(await tables()).not.toContain('webmaster_removals');

    await runMigrations(db);
    expect(await tables()).toContain('webmaster_removals');
    const indexes = (await db.all(sql`select name, "unique" from pragma_index_list('webmaster_removals') where origin = 'c'`)) as Array<{ name: string; unique: number }>;
    expect(indexes.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'webmaster_removals_next', unique: 0 },
      { name: 'webmaster_removals_site', unique: 1 },
    ]);
    const columns = (await db.all(sql`select name from pragma_index_info('webmaster_removals_site') order by seqno`)) as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toEqual(['service', 'site_url', 'account']);

    const entry = (id: string, account: string) => ({ id, projectId: 'gone', service: 'bing' as const, siteUrl: 'https://a.example/', account, attempts: 1, nextAt: new Date(), createdAt: new Date() });
    await db.insert(webmasterRemovals).values(entry('one', 'acc-1'));
    const duplicate = await db.insert(webmasterRemovals).values(entry('two', 'acc-1')).then(
      () => null,
      (err: Error & { cause?: Error }) => err.cause?.message ?? err.message,
    );
    expect(duplicate).toMatch(/UNIQUE constraint failed: webmaster_removals\.service, webmaster_removals\.site_url, webmaster_removals\.account/);
    await db.insert(webmasterRemovals).values(entry('three', 'acc-2')); // the same site with another account is another entry
    expect((await db.select().from(webmasterRemovals)).map((r) => r.owners)).toEqual([[], []]);
  });
});
