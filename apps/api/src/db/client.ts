import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Database = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  client: Client;
}

/**
 * Creates a Drizzle database over libsql and applies the connection setup pragmas. `url` defaults to
 * an in-memory DB (used by tests); production passes a `file:` URL.
 *
 * The pragmas run before any query:
 * - **WAL** — readers no longer block the writer (and vice-versa, as plain rollback journaling does),
 *   and commits are a fast append to the `-wal` file. The mode is persisted in the file header (a
 *   no-op `memory` for an in-memory test DB).
 * - **busy_timeout = 5s** — on lock contention, WAIT rather than failing immediately with
 *   `SQLITE_BUSY` (the default `0`). Matters the instant there is more than one connection — e.g. a
 *   second API replica sharing the file, or the driver opening a parallel connection.
 * - **synchronous = NORMAL** — the canonical WAL pairing: no `fsync` per commit (only at a
 *   checkpoint, ~every 1000 WAL pages), vs the previous `FULL` which fsynced every commit. The DB
 *   stays CONSISTENT through any crash; the only exposure is a hard power-cut / kernel panic, which
 *   can lose the last committed-but-uncheckpointed transactions (acceptable for re-authorable site
 *   content). Back up the `-wal` sidecar too (see the Dockerfile note).
 */
export async function createDb(url = ':memory:'): Promise<DbHandle> {
  const client = createClient({ url });
  await client.executeMultiple(
    'PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;',
  );
  const db = drizzle(client, { schema });
  return { db, client };
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
