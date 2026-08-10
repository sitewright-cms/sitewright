import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDb } from './helpers.js';
import { findUnusedMedia } from '../src/repo/media-usage.js';
import { content, contentRevisions, projects } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID } from '../src/repo/global-library.js';
import { newId } from '../src/id.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let projectId: string;

const row = async (over: Record<string, unknown>) =>
  db.insert(content).values({
    id: newId(),
    projectId,
    entityId: newId(),
    scope: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never);

/** A media asset with a known id, so a reference to it can be planted anywhere. */
const asset = async (id: string) =>
  db.insert(content).values({
    id: newId(),
    projectId,
    kind: 'media',
    entityId: id,
    scope: '',
    data: { id, kind: 'image', name: `${id}-pic.png`, url: `/media/site/${id}-pic.png` },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const unusedIds = async () => (await findUnusedMedia(db, projectId)).unused.map((u) => u.id).sort();

beforeEach(async () => {
  db = await makeTestDb();
  projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, name: 'Site', slug: 'site', createdAt: new Date() });
  // The global library is a real project row (seedGlobalLibrary creates it); the FK needs it here too.
  await db
    .insert(projects)
    .values({ id: GLOBAL_SCOPE_ID, name: 'Global Library', slug: GLOBAL_SCOPE_ID, createdAt: new Date() })
    .onConflictDoNothing();
});

describe('findUnusedMedia', () => {
  it('finds an asset nothing points at, and leaves a referenced one alone', async () => {
    await asset('aaaaaa');
    await asset('bbbbbb');
    await row({ kind: 'page', data: { id: 'home', source: '<img src="/media/site/aaaaaa-pic.png">' } });
    expect(await unusedIds()).toEqual(['bbbbbb']);
  });

  describe('★ every place a reference can live', () => {
    it('SETTINGS — the logo, icon, OG image, critical CSS and project scripts all live there', async () => {
      await asset('logo11');
      await row({ kind: 'settings', entityId: 'settings', data: { identity: { logo: '/media/site/logo11-pic.png' } } });
      expect(await unusedIds()).toEqual([]);
    });

    it('the GLOBAL library — its snippets render into this project’s pages', async () => {
      await asset('glob11');
      await db.insert(content).values({
        id: newId(),
        projectId: GLOBAL_SCOPE_ID,
        kind: 'snippet',
        entityId: 'shared',
        scope: '',
        data: { id: 'shared', source: '<img src="/media/site/glob11-pic.png">' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(await unusedIds()).toEqual([]);
    });

    for (const kind of ['template', 'snippet', 'translation', 'dataset', 'entry', 'form', 'imagemap'] as const) {
      it(`${kind} rows are searched too`, async () => {
        await asset('kkkkkk');
        await row({ kind, data: { id: 'x', anything: '/media/site/kkkkkk-pic.png' } });
        expect(await unusedIds()).toEqual([]);
      });
    }
  });

  describe('★ version history is reported, not hidden', () => {
    it('flags an asset that ONLY an old revision refers to', async () => {
      // Deleting it breaks a RESTORE rather than a page — a different decision, so it must not be
      // folded into a "select all and delete" that an author takes on trust.
      await asset('histry');
      await db.insert(contentRevisions).values({
        id: newId(),
        projectId,
        kind: 'page',
        entityId: 'home',
        scope: '',
        data: { id: 'home', source: '<img src="/media/site/histry-pic.png">' },
        op: 'put',
        userId: 'u1',
        actor: 'user',
        revisionAt: new Date(),
      } as never);
      const scan = await findUnusedMedia(db, projectId);
      expect(scan.unused).toEqual([{ id: 'histry', onlyInHistory: true }]);
    });

    it('an asset nothing refers to at all is not flagged as historical', async () => {
      await asset('nobody');
      const scan = await findUnusedMedia(db, projectId);
      expect(scan.unused).toEqual([{ id: 'nobody', onlyInHistory: false }]);
    });
  });

  it('★ a reference in ANOTHER project does not save this project’s asset', async () => {
    // Media is tenant-scoped; a same-id string in someone else's content is a coincidence, not a use.
    await asset('tenant');
    const other = randomUUID();
    await db.insert(projects).values({ id: other, name: 'Other', slug: 'other', createdAt: new Date() });
    await db.insert(content).values({
      id: newId(),
      projectId: other,
      kind: 'page',
      entityId: 'home',
      scope: '',
      data: { id: 'home', source: '<img src="/media/other/tenant-pic.png">' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await unusedIds()).toEqual(['tenant']);
  });

  it('never treats a media row as a reference to itself', async () => {
    await asset('selfie');
    expect(await unusedIds()).toEqual(['selfie']);
  });

  it('reports what it searched, so the UI can say so instead of asking for trust', async () => {
    await asset('aaaaaa');
    await row({ kind: 'page', data: { id: 'home', source: 'hello' } });
    const scan = await findUnusedMedia(db, projectId);
    expect(scan.scanned.assets).toBe(1);
    expect(scan.scanned.contentRows).toBe(1);
    expect(scan.scanned).toHaveProperty('globalRows');
    expect(scan.scanned).toHaveProperty('revisionRows');
  });

  it('says nothing is unused when there is no media at all', async () => {
    expect(await findUnusedMedia(db, projectId)).toMatchObject({ unused: [] });
  });
});
