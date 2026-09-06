import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GLOBAL_SNIPPETS, WIDGET_PARTIALS } from '@sitewright/core';
import { makeTestDb } from './helpers.js';

const SQL = fileURLToPath(new URL('../drizzle/0027_marquee_snippet_rename.sql', import.meta.url));

/** The shipped migration statement, comments stripped — exactly what runs on container update. */
async function migrationSql(): Promise<string> {
  const raw = await readFile(SQL, 'utf8');
  return raw
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .trim();
}

async function seedLegacyRow(db: Awaited<ReturnType<typeof makeTestDb>>, entityId: string): Promise<void> {
  await db.run(
    `INSERT INTO content (id, project_id, kind, entity_id, scope, data, created_at, updated_at)
     VALUES ('row-${entityId}', '__global__', 'snippet', '${entityId}', '',
             json('{"id":"${entityId}","name":"${entityId}","source":"<p>marquee</p>"}'), 0, 0)`,
  );
}

async function names(db: Awaited<ReturnType<typeof makeTestDb>>): Promise<string[]> {
  const res = await db.all<{ entity_id: string; name: string }>(
    `SELECT entity_id, json_extract(data,'$.name') AS name FROM content
     WHERE project_id='__global__' AND kind='snippet'`,
  );
  return res.map((r) => `${r.entity_id}:${r.name}`);
}

describe('0027 logo-marquee snippet rename', () => {
  it('renames the stored row and its embedded id/name', async () => {
    const db = await makeTestDb();
    await db.run(`INSERT INTO projects (id, name, slug, created_at) VALUES ('__global__','Global','__global__',0)`);
    await seedLegacyRow(db, 'logo-marquee');
    await db.run(await migrationSql());
    expect(await names(db)).toEqual(['logo-marquee-snippet:logo-marquee-snippet']);
  });

  it('is idempotent and leaves an already-renamed instance alone', async () => {
    const db = await makeTestDb();
    await db.run(`INSERT INTO projects (id, name, slug, created_at) VALUES ('__global__','Global','__global__',0)`);
    await seedLegacyRow(db, 'logo-marquee');
    const sql = await migrationSql();
    await db.run(sql);
    await db.run(sql); // second run must be a no-op, not a UNIQUE violation
    expect(await names(db)).toEqual(['logo-marquee-snippet:logo-marquee-snippet']);
  });

  it('does not collide with the target when BOTH rows somehow exist (uniq_content is UNIQUE)', async () => {
    const db = await makeTestDb();
    await db.run(`INSERT INTO projects (id, name, slug, created_at) VALUES ('__global__','Global','__global__',0)`);
    await seedLegacyRow(db, 'logo-marquee');
    await seedLegacyRow(db, 'logo-marquee-snippet');
    await db.run(await migrationSql()); // must not throw
    expect((await names(db)).sort()).toEqual([
      'logo-marquee-snippet:logo-marquee-snippet',
      'logo-marquee:logo-marquee',
    ]);
  });

  it('leaves no built-in global snippet colliding with a widget name', () => {
    const clashes = GLOBAL_SNIPPETS.filter((s) => Object.hasOwn(WIDGET_PARTIALS, s.name)).map((s) => s.name);
    expect(clashes).toEqual([]);
    expect(GLOBAL_SNIPPETS.map((s) => s.name)).toContain('logo-marquee-snippet');
  });
});
