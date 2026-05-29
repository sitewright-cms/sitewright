import { createDb, runMigrations, type Database } from '../src/db/client.js';

/** A fresh, migrated in-memory database for a test. */
export async function makeTestDb(): Promise<Database> {
  const { db } = createDb();
  await runMigrations(db);
  return db;
}
