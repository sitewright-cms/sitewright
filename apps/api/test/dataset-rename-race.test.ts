import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb } from './helpers.js';
import { registerAccount, addProjectMember } from '../src/repo/accounts.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { ContentRepository } from '../src/repo/content.js';
import type { ProjectContext } from '../src/repo/context.js';
import type { Database } from '../src/db/client.js';

let db: Database;
let content: ContentRepository;
let ctx: ProjectContext;

beforeEach(async () => {
  db = await makeTestDb();
  content = new ContentRepository(db);
  const a = await registerAccount(db, 'race@acme.test', 'Pw-secret-1');
  const project = await new ProjectRepository(db).create({ name: 'A', slug: 'race' });
  await addProjectMember(db, a.userId, project.id, 'owner');
  ctx = { userId: a.userId, projectId: project.id, role: 'owner' };
  await content.put(ctx, 'dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }] });
});

const settings = (name: string) => ({ identity: { name }, website: { footer: '<div>{{#each dataset.items}}{{title}}{{/each}}</div>' }, settings: {} });
const page = (title: string) => ({ id: 'home', path: '', title, source: '<div>{{#each dataset.items}}{{title}}{{/each}}</div>' });

/**
 * Run `write` at the moment the rename asks for its transaction — after anything it read BEFORE the
 * transaction, before anything it reads inside it. That is exactly the window in which a rename that plans
 * from earlier reads writes stale whole rows back over somebody else's save.
 */
function writeWhenTheRenameOpensItsTransaction(write: () => Promise<unknown>): void {
  const real = db.transaction.bind(db);
  db.transaction = (async (...args: Parameters<typeof real>) => {
    db.transaction = real; // one shot
    await write();
    return real(...args);
  }) as typeof db.transaction;
}

/**
 * A rename rewrites WHOLE rows (a page, the settings). Everything it rewrites has to be read inside the write
 * transaction that replaces it — writes queue behind one another (db/sqlite.ts `WriteGate`), so nothing can
 * land between that read and the commit — or a save made while the rename was planning is silently reverted.
 */
describe('a dataset rename racing other saves', () => {
  it('does not revert a page saved while the rename was under way', async () => {
    await content.put(ctx, 'page', 'home', page('original'));
    writeWhenTheRenameOpensItsTransaction(() => content.put(ctx, 'page', 'home', page('edited in another tab')));

    await content.renameDataset(ctx, 'ds1', 'features', { cascade: true });

    const stored = (await content.get(ctx, 'page', 'home')) as { title: string; source: string };
    expect(stored.title).toBe('edited in another tab');
    expect(stored.source).toBe('<div>{{#each dataset.features}}{{title}}{{/each}}</div>');
  });

  it('does not revert the site settings saved while the rename was under way', async () => {
    await content.put(ctx, 'settings', 'settings', settings('Before'));
    writeWhenTheRenameOpensItsTransaction(() => content.put(ctx, 'settings', 'settings', settings('Renamed company')));

    await content.renameDataset(ctx, 'ds1', 'features', { cascade: true });

    const stored = (await content.get(ctx, 'settings', 'settings')) as { identity: { name: string }; website: { footer: string } };
    expect(stored.identity.name).toBe('Renamed company');
    expect(stored.website.footer).toBe('<div>{{#each dataset.features}}{{title}}{{/each}}</div>');
  });

  it('moves an entry created while the rename was under way instead of stranding it on the old slug', async () => {
    writeWhenTheRenameOpensItsTransaction(() => content.put(ctx, 'entry', 'late', { id: 'late', dataset: 'items', values: { title: 'Late' } }));

    const res = await content.renameDataset(ctx, 'ds1', 'features', { cascade: true });

    expect(res.entriesUpdated).toBe(1);
    expect(((await content.get(ctx, 'entry', 'late', 'features')) as { dataset: string }).dataset).toBe('features');
    await expect(content.get(ctx, 'entry', 'late', 'items')).rejects.toThrow(/not found/);
  });

  it('does not revert a dataset schema edit made while the rename was under way', async () => {
    writeWhenTheRenameOpensItsTransaction(() =>
      content.put(ctx, 'dataset', 'ds1', { id: 'ds1', name: 'Items', slug: 'items', fields: [{ name: 'title', type: 'text' }, { name: 'added', type: 'number' }] }),
    );

    await content.renameDataset(ctx, 'ds1', 'features', { cascade: true });

    const stored = (await content.get(ctx, 'dataset', 'ds1')) as { slug: string; fields: Array<{ name: string }> };
    expect(stored.slug).toBe('features');
    expect(stored.fields.map((f) => f.name)).toEqual(['title', 'added']);
  });

  it('under genuine concurrency, the outcome is one of the two serial orders — never a torn mix', async () => {
    const saved = { id: 'home', path: '', title: 'concurrent', source: '<div>{{#each dataset.items}}{{title}}{{/each}}<p>new</p></div>' };
    for (let round = 0; round < 5; round += 1) {
      await content.renameDataset(ctx, 'ds1', 'items', { cascade: true }); // back to the start (no-op on round 0)
      await content.put(ctx, 'page', 'home', page('original'));
      await Promise.all([content.renameDataset(ctx, 'ds1', 'features', { cascade: true }), content.put(ctx, 'page', 'home', saved)]);
      const stored = (await content.get(ctx, 'page', 'home')) as { title: string; source: string };
      expect(((await content.get(ctx, 'dataset', 'ds1')) as { slug: string }).slug).toBe('features');
      // The save is a full replace, so either it landed first and the rename rewrote it, or it landed after and
      // is exactly what was sent. The rename never writes back the 'original' it might have seen.
      expect([
        { title: 'concurrent', source: '<div>{{#each dataset.features}}{{title}}{{/each}}<p>new</p></div>' },
        { title: 'concurrent', source: saved.source },
      ]).toContainEqual({ title: stored.title, source: stored.source });
      await content.renameDataset(ctx, 'ds1', 'items', { cascade: true });
    }
  });

  it('a save QUEUED while the rename holds the write gate lands after it, on top of the renamed state', async () => {
    await content.put(ctx, 'page', 'home', page('original'));
    await content.put(ctx, 'page', 'other', { id: 'other', path: 'other', title: 'Other', source: '<div>x</div>' });
    const real = db.transaction.bind(db);
    let queued: Promise<unknown> | undefined;
    db.transaction = ((fn: Parameters<typeof real>[0], ...rest: unknown[]) => {
      db.transaction = real;
      return (real as (...a: unknown[]) => ReturnType<typeof real>)(async (tx: unknown) => {
        // Started once the rename's transaction is open, and given ample time to finish — a page save takes a
        // few milliseconds — BEFORE the rename reads anything. Only the write gate can hold it back.
        queued = content.put(ctx, 'page', 'home', { id: 'home', path: '', title: 'queued', source: '<div>{{#each dataset.features}}{{title}}{{/each}}</div>' });
        await new Promise((r) => setTimeout(r, 30));
        return (fn as (t: unknown) => Promise<unknown>)(tx);
      }, ...rest);
    }) as typeof db.transaction;

    const res = await content.renameDataset(ctx, 'ds1', 'features', { cascade: true });
    await queued;

    // PROOF the save was still queued when the rename read the page: the rename found `dataset.items` there to
    // rewrite. Had the save landed first, the page would already have said `dataset.features` (0 rewritten).
    expect(res.pagesUpdated).toBe(1);
    // …and the save then landed on top of the rename, not lost.
    const stored = (await content.get(ctx, 'page', 'home')) as { title: string; source: string };
    expect(stored).toMatchObject({ title: 'queued', source: '<div>{{#each dataset.features}}{{title}}{{/each}}</div>' });
    expect(((await content.get(ctx, 'dataset', 'ds1')) as { slug: string }).slug).toBe('features');
  });

  it('a failure in a later write rolls the WHOLE rename back — no dataset, entry, page or snippet half-renamed', async () => {
    await content.put(ctx, 'entry', 'e1', { id: 'e1', dataset: 'items', values: { title: 'A' } });
    await content.put(ctx, 'page', 'home', page('original'));
    await content.put(ctx, 'snippet', 'list', { id: 'list', name: 'list', source: '<ul>{{#each dataset.items}}<li>x</li>{{/each}}</ul>' });
    await content.put(ctx, 'settings', 'settings', settings('Before'));
    // The settings row is the LAST thing the rename writes; fail it.
    const proto = ContentRepository.prototype as unknown as { writeRow: (...a: unknown[]) => Promise<unknown> };
    const original = proto.writeRow;
    const spy = vi.spyOn(proto, 'writeRow').mockImplementation(function (this: unknown, ...args: unknown[]) {
      if (args[2] === 'settings') return Promise.reject(new Error('disk full'));
      return original.apply(this, args);
    });
    try {
      await expect(content.renameDataset(ctx, 'ds1', 'features', { cascade: true })).rejects.toThrow(/disk full/);
    } finally {
      spy.mockRestore();
    }

    expect(((await content.get(ctx, 'dataset', 'ds1')) as { slug: string }).slug).toBe('items');
    expect(((await content.get(ctx, 'entry', 'e1', 'items')) as { dataset: string }).dataset).toBe('items');
    await expect(content.get(ctx, 'entry', 'e1', 'features')).rejects.toThrow(/not found/);
    expect(((await content.get(ctx, 'page', 'home')) as { source: string }).source).toContain('dataset.items}}');
    expect(((await content.get(ctx, 'snippet', 'list')) as { source: string }).source).toContain('dataset.items}}');
    expect(((await content.get(ctx, 'settings', 'settings')) as { website: { footer: string } }).website.footer).toContain('dataset.items}}');
  });
});
