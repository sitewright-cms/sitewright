import type { Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { openSqlite } from './sqlite.js';

export type Database = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  client: Client;
}

/**
 * Creates a Drizzle database over libsql. `url` defaults to an in-memory DB (used by tests); production passes a
 * `file:` URL. `openSqlite` sets the file up — WAL, a lock wait and `synchronous = NORMAL` on every connection — and
 * queues this process's writes, so a write meeting an open transaction waits for it instead of failing.
 *
 * Foreign keys need no pragma: libsql turns them ON for every connection it opens. `test/project-reap.test.ts` pins
 * that default.
 */
export async function createDb(url = ':memory:'): Promise<DbHandle> {
  const client = await openSqlite(url);
  const db = drizzle(client, { schema });
  return { db, client };
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
