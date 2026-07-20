import { randomBytes } from 'node:crypto';
import { readFile, readdir, mkdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import { DEFAULT_BACKUP_RETENTION } from '@sitewright/schema';

// The same drizzle folder runMigrations reads (SQL files + meta/_journal.json).
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Fallback retention when a caller passes none — the admin `backupRetention` setting overrides this. */
export const PRE_MIGRATION_BACKUP_KEEP = DEFAULT_BACKUP_RETENTION;

const BACKUP_SUFFIX = '.pre-migration.bak';

/** The pre-migration snapshot directory under the data dir. */
export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

/**
 * Non-null iff `databaseUrl` is a LOCAL `file:` DB (remote `libsql://` → null). The returned path is
 * best-effort (a query string is stripped) and used only as a local-vs-remote presence check — the actual
 * backup target is always derived from the trusted data dir, never from this value.
 */
export function dbFilePath(databaseUrl: string): string | null {
  if (!databaseUrl.startsWith('file:')) return null;
  const path = databaseUrl.slice('file:'.length).replace(/\?.*$/, '');
  return path || null;
}

/**
 * How many migrations drizzle has recorded as applied. Returns -1 when the tracking table doesn't exist
 * yet — a brand-new DB with nothing to protect.
 */
export async function appliedMigrationCount(client: Client): Promise<number> {
  try {
    const res = await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations');
    return Number(res.rows[0]?.n ?? 0);
  } catch {
    return -1; // tracking table absent → fresh DB
  }
}

/** How many migrations are defined in the drizzle journal (meta/_journal.json). */
export async function journalMigrationCount(migrationsFolder = MIGRATIONS_FOLDER): Promise<number> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted build-time migrations path
    const raw = await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8');
    const journal = JSON.parse(raw) as { entries?: unknown[] };
    return Array.isArray(journal.entries) ? journal.entries.length : 0;
  } catch {
    return 0;
  }
}

/** A sortable UTC stamp for a backup filename, e.g. `20260720T104512Z` (lexical order == chronological). */
function backupStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Deletes the oldest pre-migration snapshots in `backupDir`, keeping the newest `keep`. Best-effort:
 * a failure to remove one file never throws. `keep <= 0` keeps everything (pruning disabled).
 */
export async function pruneBackups(backupDir: string, keep: number, log: (m: string) => void = () => {}): Promise<number> {
  if (keep <= 0) return 0;
  let names: string[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted data-dir path
    names = (await readdir(backupDir)).filter((n) => n.endsWith(BACKUP_SUFFIX));
  } catch {
    return 0; // no backup dir yet
  }
  if (names.length <= keep) return 0;
  names.sort(); // sortable timestamps → lexical == chronological
  let removed = 0;
  for (const name of names.slice(0, names.length - keep)) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted data-dir path
      await unlink(join(backupDir, name));
      removed += 1;
      log(`pruned old snapshot ${name}`);
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

/** On-disk size of the SQLite DB incl. its `-wal`/`-shm` sidecars (bytes); 0 for a remote/absent DB. */
export async function dbSizeBytes(dbFile: string | null): Promise<number> {
  if (!dbFile) return 0;
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted db path
      total += (await stat(`${dbFile}${suffix}`)).size;
    } catch {
      /* sidecar absent */
    }
  }
  return total;
}

/** Count + total bytes of the pre-migration snapshots in `backupDir`. */
export async function backupsSummary(backupDir: string): Promise<{ count: number; bytes: number }> {
  let names: string[];
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted data-dir path
    names = (await readdir(backupDir)).filter((n) => n.endsWith(BACKUP_SUFFIX));
  } catch {
    return { count: 0, bytes: 0 };
  }
  let bytes = 0;
  for (const name of names) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted data-dir path
      bytes += (await stat(join(backupDir, name))).size;
    } catch {
      /* raced away */
    }
  }
  return { count: names.length, bytes };
}

/**
 * Operator-triggered purge: keep only the newest `keepLast` (≥1) snapshots and delete the rest. Returns
 * how many were removed plus the post-purge summary.
 */
export async function purgeBackups(
  backupDir: string,
  keepLast: number,
  log: (m: string) => void = () => {},
): Promise<{ removed: number; count: number; bytes: number }> {
  const removed = await pruneBackups(backupDir, Math.max(1, Math.floor(keepLast)), log);
  const summary = await backupsSummary(backupDir);
  return { removed, ...summary };
}

/**
 * Takes a WAL-safe, consistent snapshot of the SQLite DB into `<dataDir>/backups/` — but ONLY when there
 * are pending schema migrations, so an operator can roll back if a migration goes wrong. Uses SQLite's
 * `VACUUM INTO`, which writes a single compact copy from a consistent read (no `-wal` sidecar to manage),
 * so it's safe under WAL. Returns the snapshot path, or null when nothing was taken.
 *
 * Scope (deliberate): DB ONLY. Migrations never touch media/published-sites/preview, so snapshotting those
 * on every upgrade would be slow + waste disk for no risk reduction — full-instance backup is a separate,
 * operator-driven concern. Only runs for a local `file:` DB (a remote libsql is the provider's job).
 *
 * Restore (manual, app stopped): copy the chosen `*.pre-migration.bak` over `<dataDir>/sitewright.db`,
 * delete any `sitewright.db-wal`/`-shm` sidecars, then start the app.
 */
export async function backupBeforeMigrations(opts: {
  client: Client;
  databaseUrl: string;
  dataDir: string;
  now: Date;
  keep?: number;
  migrationsFolder?: string;
  log?: (m: string) => void;
}): Promise<string | null> {
  const { client, databaseUrl, dataDir, now } = opts;
  const keep = opts.keep ?? PRE_MIGRATION_BACKUP_KEEP;
  const log = opts.log ?? (() => {});

  const filePath = dbFilePath(databaseUrl);
  if (!filePath) {
    log('remote database — skipping pre-migration snapshot (provider-managed)');
    return null;
  }

  const applied = await appliedMigrationCount(client);
  const journal = await journalMigrationCount(opts.migrationsFolder);
  // Fresh DB (no tracking table) → nothing to protect. Up-to-date (applied >= journal) → no pending work.
  if (applied < 0 || applied >= journal) return null;

  const backupDir = backupsDir(dataDir);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted data-dir path
  await mkdir(backupDir, { recursive: true });
  // A short random suffix disambiguates two snapshots taken in the same wall-clock second (e.g. a fast
  // restart loop while a migration stays broken), so `VACUUM INTO` never fails on an existing target.
  const target = join(backupDir, `sitewright-${backupStamp(now)}-${randomBytes(3).toString('hex')}${BACKUP_SUFFIX}`);

  log(`pending migration detected (${applied}/${journal} applied) — snapshotting DB → ${target}`);
  // VACUUM INTO accepts an SQL expression for the filename, so bind the path as a parameter (avoids any
  // quoting issue) and get a consistent single-file copy.
  await client.execute({ sql: 'VACUUM INTO ?', args: [target] });
  log(`pre-migration snapshot complete → ${target}`);

  await pruneBackups(backupDir, keep, log);
  return target;
}
