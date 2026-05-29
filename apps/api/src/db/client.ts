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
 * Creates a Drizzle database over libsql. `url` defaults to an in-memory DB
 * (used by tests); production passes a `file:` URL.
 */
export function createDb(url = ':memory:'): DbHandle {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
