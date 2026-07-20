import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import type { Client } from '@libsql/client';
import { createDb, runMigrations } from '../src/db/client.js';
import {
  dbFilePath,
  appliedMigrationCount,
  journalMigrationCount,
  pruneBackups,
  backupBeforeMigrations,
  dbSizeBytes,
  backupsSummary,
  purgeBackups,
  PRE_MIGRATION_BACKUP_KEEP,
} from '../src/db/backup.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** A fresh temp data dir + a migrated file DB, tracked for cleanup. */
async function makeFileDb(migrated: boolean): Promise<{ dir: string; databaseUrl: string; client: Client }> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-backup-'));
  const dbFile = join(dir, 'sitewright.db');
  const databaseUrl = `file:${dbFile}`;
  const { db, client } = await createDb(databaseUrl);
  if (migrated) await runMigrations(db);
  cleanups.push(async () => {
    try {
      client.close();
    } catch {
      /* already closed */
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, databaseUrl, client };
}

describe('dbFilePath', () => {
  it('extracts the path from a file: URL and rejects a remote URL', () => {
    expect(dbFilePath('file:/app/data/sitewright.db')).toBe('/app/data/sitewright.db');
    expect(dbFilePath('libsql://db.turso.io')).toBeNull();
    expect(dbFilePath('file:')).toBeNull();
  });
});

describe('migration counting', () => {
  it('journal has ≥1 migration and matches the applied count on a fully-migrated DB', async () => {
    const { client } = await makeFileDb(true);
    const journal = await journalMigrationCount();
    const applied = await appliedMigrationCount(client);
    expect(journal).toBeGreaterThan(0);
    expect(applied).toBe(journal); // catches a wrong tracking-table name (would be -1)
  });

  it('reports -1 applied on a brand-new DB (no tracking table)', async () => {
    const { client } = await makeFileDb(false); // never migrated
    expect(await appliedMigrationCount(client)).toBe(-1);
  });
});

describe('backupBeforeMigrations', () => {
  it('skips a remote (non-file) database', async () => {
    const { client } = await makeFileDb(true);
    expect(
      await backupBeforeMigrations({ client, databaseUrl: 'libsql://x', dataDir: '/nope', now: new Date() }),
    ).toBeNull();
  });

  it('skips a fresh DB (nothing applied yet — nothing to protect)', async () => {
    const { dir, databaseUrl, client } = await makeFileDb(false);
    const res = await backupBeforeMigrations({ client, databaseUrl, dataDir: dir, now: new Date() });
    expect(res).toBeNull();
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('skips when the DB is already up to date (no pending migration)', async () => {
    const { dir, databaseUrl, client } = await makeFileDb(true);
    const res = await backupBeforeMigrations({ client, databaseUrl, dataDir: dir, now: new Date() });
    expect(res).toBeNull();
  });

  it('snapshots (WAL-safe, valid, contains the data) when a migration is pending', async () => {
    const { dir, databaseUrl, client } = await makeFileDb(true);
    // Simulate a pending migration: drop the newest applied-migration record so applied < journal.
    // (Use rowid — drizzle's __drizzle_migrations `id` column isn't a reliable autoincrement PK here.)
    const del = await client.execute('DELETE FROM __drizzle_migrations WHERE rowid = (SELECT MAX(rowid) FROM __drizzle_migrations)');
    expect(del.rowsAffected).toBe(1);

    const target = await backupBeforeMigrations({ client, databaseUrl, dataDir: dir, now: new Date() });
    expect(target).not.toBeNull();
    expect(target!.endsWith('.pre-migration.bak')).toBe(true);
    expect(existsSync(target!)).toBe(true);

    // The snapshot is a self-contained, valid SQLite DB with the real schema (open + query a table).
    const { client: bclient } = await createDb(`file:${target}`);
    const res = await bclient.execute('SELECT COUNT(*) AS n FROM users');
    expect(Number(res.rows[0]!.n)).toBeGreaterThanOrEqual(0);
    bclient.close();
  });
});

describe('pruneBackups', () => {
  it('keeps the newest N snapshots and removes older ones (chronological by name)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-prune-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const stamps = ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z', '20260401T000000Z', '20260501T000000Z'];
    for (const s of stamps) await writeFile(join(dir, `sitewright-${s}.pre-migration.bak`), 'x');
    // An unrelated file must be left untouched.
    await writeFile(join(dir, 'keep-me.txt'), 'x');

    await pruneBackups(dir, 2);
    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual([
      'keep-me.txt',
      'sitewright-20260401T000000Z.pre-migration.bak',
      'sitewright-20260501T000000Z.pre-migration.bak',
    ]);
  });

  it('is a no-op when at/under the keep count, and keep<=0 disables pruning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-prune-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    for (const s of ['20260101T000000Z', '20260201T000000Z']) {
      await writeFile(join(dir, `sitewright-${s}.pre-migration.bak`), 'x');
    }
    await pruneBackups(dir, PRE_MIGRATION_BACKUP_KEEP); // well above 2 → keep all
    expect((await readdir(dir)).length).toBe(2);
    await pruneBackups(dir, 0); // disabled → keep all
    expect((await readdir(dir)).length).toBe(2);
  });
});

describe('storage introspection + purge', () => {
  it('dbSizeBytes sums the DB (+ WAL sidecars); 0 for a remote/absent DB', async () => {
    const { dir } = await makeFileDb(true);
    expect(await dbSizeBytes(join(dir, 'sitewright.db'))).toBeGreaterThan(0);
    expect(await dbSizeBytes(null)).toBe(0);
    expect(await dbSizeBytes(join(dir, 'nope.db'))).toBe(0);
  });

  it('backupsSummary counts + sizes only *.pre-migration.bak files', async () => {
    const d = await mkdtemp(join(tmpdir(), 'sw-sum-'));
    cleanups.push(() => rm(d, { recursive: true, force: true }));
    await writeFile(join(d, 'sitewright-20260101T000000Z.pre-migration.bak'), 'abc'); // 3 bytes
    await writeFile(join(d, 'sitewright-20260201T000000Z.pre-migration.bak'), 'de'); // 2 bytes
    await writeFile(join(d, 'unrelated.txt'), 'ignored');
    expect(await backupsSummary(d)).toEqual({ count: 2, bytes: 5 });
    expect(await backupsSummary(join(d, 'missing'))).toEqual({ count: 0, bytes: 0 });
  });

  it('purgeBackups keeps the newest keepLast, reports removed + summary, and never wipes all', async () => {
    const d = await mkdtemp(join(tmpdir(), 'sw-purge-'));
    cleanups.push(() => rm(d, { recursive: true, force: true }));
    for (const s of ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z']) {
      await writeFile(join(d, `sitewright-${s}.pre-migration.bak`), 'x');
    }
    const r = await purgeBackups(d, 1);
    expect(r.removed).toBe(2);
    expect(r.count).toBe(1);
    expect(await readdir(d)).toEqual(['sitewright-20260301T000000Z.pre-migration.bak']); // newest kept
    // keepLast is clamped to ≥1 — a 0 can't wipe everything.
    expect((await purgeBackups(d, 0)).count).toBe(1);
  });
});
