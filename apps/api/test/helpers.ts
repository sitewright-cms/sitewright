import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, type Database } from '../src/db/client.js';

/**
 * A fresh, migrated database for a test. Uses a unique temp **file** DB: file
 * databases are shared across every connection the driver opens (migrate vs
 * queries) — unlike libsql `:memory:`, which is per-connection — and it matches
 * how the deployed container runs. Files land in the OS temp dir.
 */
export async function makeTestDb(): Promise<Database> {
  const file = join(tmpdir(), `sw-api-test-${randomUUID()}.db`);
  const { db } = createDb(`file:${file}`);
  await runMigrations(db);
  return db;
}
