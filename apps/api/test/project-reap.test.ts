import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { registerAccount } from '../src/repo/accounts.js';
import { agentGrants } from '../src/db/schema.js';

// REAP = the permanent delete behind the admin "deleted projects" purge. There is no ON DELETE CASCADE
// in this schema, so `ProjectRepository.remove()` must clear every table holding an FK to `projects`
// itself. A table missed there does not fail loudly at write time — it fails only when someone tries to
// purge, with SQLITE_CONSTRAINT_FOREIGNKEY, and that project can then NEVER be removed. `agent_grants`
// was missed exactly this way: five projects on the shared instance became permanently un-purgeable.

/** Every table with an FK to `projects`, read from the migrated schema itself. */
async function projectFkTables(db: Awaited<ReturnType<typeof makeTestDb>>): Promise<string[]> {
  const tables = (await db.all(
    sql`select name from sqlite_master where type='table' and name not like 'sqlite_%'`,
  )) as Array<{ name: string }>;
  const referencing: string[] = [];
  for (const { name } of tables) {
    const fks = (await db.all(sql`select "table" as target from pragma_foreign_key_list(${name})`)) as Array<{ target: string }>;
    if (fks.some((f) => f.target === 'projects')) referencing.push(name);
  }
  return referencing.sort();
}

describe('project reap', () => {
  // The drift guard: the FK children `remove()` is responsible for clearing. (`remove()` also clears
  // `ai_usage` and `oauth_device_codes`, which carry no FK — they are cleanup, not a constraint, so they
  // are not listed here.) Adding a table that references `projects` fails this test by name, forcing the
  // author to add BOTH a `tx.delete(...)` in remove() and an entry here — rather than shipping a project
  // that silently cannot ever be purged.
  const REAPED_TABLES = [
    'agent_grants',
    'api_keys',
    'content',
    'content_revisions',
    'form_submissions',
    'invites',
    'oauth_auth_codes',
    'oauth_refresh_tokens',
    'project_members',
  ].sort();

  it('remove() clears EVERY table that carries an FK to projects', async () => {
    const db = await makeTestDb();
    const referencing = await projectFkTables(db);
    // If this fails, a new table references `projects` — add a `tx.delete(...)` for it in
    // ProjectRepository.remove() and list it here. Do not just update the list.
    expect(referencing).toEqual(REAPED_TABLES);
  });

  it('reaps a project that holds an agent grant (the FK that made projects un-purgeable)', async () => {
    const db = await makeTestDb();
    const projects = new ProjectRepository(db);
    const { userId } = await registerAccount(db, 'grant-owner@test.example', 'Correct-Horse-9!');
    const project = await projects.create({ name: 'Granted', slug: 'granted' });

    const now = new Date();
    await db.insert(agentGrants).values({
      id: 'grant-1',
      userId,
      projectId: project.id,
      capabilities: ['content:read'],
      autonomy: 'full',
      createdAt: now,
      updatedAt: now,
    });

    // Before the fix this threw SQLITE_CONSTRAINT_FOREIGNKEY and the project stayed forever.
    await expect(projects.remove(project.id)).resolves.toBeUndefined();
    await expect(projects.get(project.id)).rejects.toThrow(/not found/i);
    const left = (await db.all(sql`select count(*) as n from agent_grants where project_id = ${project.id}`)) as Array<{ n: number }>;
    expect(Number(left[0]?.n ?? 0)).toBe(0);
  });
});
