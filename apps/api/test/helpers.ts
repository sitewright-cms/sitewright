import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Client } from '@libsql/client';
import { createDb, runMigrations, type Database } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { setPlatformRole } from '../src/repo/accounts.js';

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
  const { db, client } = await createDb(`file:${file}`);
  createdDbs.push({ file, client });
  await runMigrations(db);
  return db;
}

/**
 * Grants instance-admin to an existing user by email — the only admin mechanism (a persisted
 * `platform_role='admin'`; there is no env email allowlist). Tests register the user via
 * `/auth/register`, then call this to promote them.
 */
export async function promoteToAdmin(db: Database, email: string): Promise<void> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
  if (!u) throw new Error(`promoteToAdmin: no user "${email}"`);
  await setPlatformRole(db, u.id, 'admin');
}
