import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import type { Client } from '@libsql/client';
import { createDb, runMigrations, type Database } from '../src/db/client.js';

// Every file DB created below + its libsql client, so each is closed and unlinked when the suite
// ends. Without this, makeTestDb() leaked a ~2 MB SQLite file (plus its -wal/-shm siblings) into
// the OS temp dir PERMANENTLY — ~100k files / ~22 GB had accumulated across runs before this.
const createdDbs: Array<{ file: string; client: Client }> = [];

// Close the client first (releases the main + -wal/-shm handles), THEN unlink the file and its
// siblings. splice(0) drains the list so the afterAll and process-exit calls are idempotent;
// the close() try/catch and rmSync(force) never throw on an already-closed/already-gone db.
// libsql's client.close() is synchronous, so this is safe to run from an 'exit' handler too.
function cleanupCreatedDbs(): void {
  for (const { file, client } of createdDbs.splice(0)) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  }
}

// Prompt cleanup when the test file's suite finishes, plus a worker-exit backstop so a
// crashed/aborted suite (afterAll never runs) still can't leak. Both call the same idempotent drain.
afterAll(cleanupCreatedDbs);
process.once('exit', cleanupCreatedDbs);

/**
 * A fresh, migrated database for a test. Uses a unique temp **file** DB: file
 * databases are shared across every connection the driver opens (migrate vs
 * queries) — unlike libsql `:memory:`, which is per-connection — and it matches
 * how the deployed container runs. The file (and its -wal/-shm siblings) is
 * closed and unlinked when the suite ends; see {@link cleanupCreatedDbs}.
 */
export async function makeTestDb(): Promise<Database> {
  const file = join(tmpdir(), `sw-api-test-${randomUUID()}.db`);
  const { db, client } = createDb(`file:${file}`);
  createdDbs.push({ file, client });
  await runMigrations(db);
  return db;
}
