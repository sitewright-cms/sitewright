import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { seedInstance } from '../src/seed.js';
import { registerAccount } from '../src/repo/accounts.js';
import { users, projects, content } from '../src/db/schema.js';

// The showcase bundle imports are BEST-EFFORT: a broken/unreadable bundle must never abort the
// bootstrap — otherwise the idempotency guard would lock in a half-seeded instance. Wrap
// listSeedBundles in a pass-through spy so one test can point the seed at a CORRUPT bundle dir
// while the others exercise the real committed bundle.
vi.mock('../src/seed-bundle.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/seed-bundle.js')>();
  return { ...mod, listSeedBundles: vi.fn(mod.listSeedBundles) };
});
import { EXAMPLE_PROJECTS_DIR, importSeedBundle, listSeedBundles } from '../src/seed-bundle.js';

describe('seedInstance — best-effort bundle import is resilient', { timeout: 30_000 }, () => {
  afterEach(() => vi.clearAllMocks());

  it('seeds the full showcase CONTENT without a mediaRoot (unit-test path: no binaries restored)', async () => {
    const db = await makeTestDb();
    const log: string[] = [];
    await seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1', log: (m) => log.push(m) });

    // Content imported from the bundle; without mediaRoot no media FILES were restored (metadata only).
    expect((await db.select().from(users)).map((u) => u.email)).toEqual(['admin@sitewright.example']);
    expect((await db.select().from(projects)).map((p) => p.slug)).toEqual(['example']);
    const example = (await db.select().from(projects)).find((p) => p.slug === 'example')!;
    const pages = await db
      .select({ id: content.entityId })
      .from(content)
      .where(and(eq(content.projectId, example.id), eq(content.kind, 'page')));
    expect(pages.length).toBeGreaterThan(0);
    expect(log.join('\n')).toMatch(/imported "Example Project" from its bundled export/);
    expect(log.join('\n')).not.toMatch(/media files/); // the counts line appends it only when files were restored
  });

  it('a corrupt bundle is warned about — the admin + the OTHER bundles still seed, and seedInstance does not throw', async () => {
    const db = await makeTestDb();
    // A directory that exists but holds an unparsable manifest → loadSeedBundle throws inside
    // importSeedBundle; the seed must catch, warn, and carry on with the remaining bundles.
    const corrupt = mkdtempSync(join(tmpdir(), 'sw-seed-corrupt-'));
    mkdirSync(join(corrupt, 'broken-bundle'));
    writeFileSync(join(corrupt, 'broken-bundle', 'manifest.json'), 'not json {');
    vi.mocked(listSeedBundles).mockResolvedValueOnce([
      join(corrupt, 'broken-bundle'), // sorts/imports FIRST — its failure must not stop the next one
      join(EXAMPLE_PROJECTS_DIR, 'example'),
    ]);
    const log: string[] = [];
    try {
      await expect(
        seedInstance({ db, adminEmail: 'admin@sitewright.example', adminPassword: 'Pw-secret-1', log: (m) => log.push(m) }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(corrupt, { recursive: true, force: true }); // don't leak the temp dir
    }

    // The broken bundle failed, yet the bootstrap completed: admin + the example project exist,
    // and the failure was caught + warned (not thrown).
    expect((await db.select().from(users)).map((u) => u.email)).toEqual(['admin@sitewright.example']);
    expect((await db.select().from(projects)).map((p) => p.slug)).toEqual(['example']);
    expect(log.join('\n')).toMatch(/showcase bundle import failed for .*broken-bundle/);
    expect(log.join('\n')).toMatch(/other bundles and the admin account are unaffected/);
  });

  it('media restore is best-effort: a missing bundles root, a bundle without media/, and unreadable media entries are all tolerated', async () => {
    // A missing bundles root lists as EMPTY (a fresh checkout without example_projects must boot).
    expect(await listSeedBundles(join(tmpdir(), `sw-no-such-root-${Date.now()}`))).toEqual([]);

    const work = mkdtempSync(join(tmpdir(), 'sw-seed-media-edge-'));
    const contentOnlyCopy = (name: string): string => {
      const dir = join(work, name);
      mkdirSync(dir);
      copyFileSync(join(EXAMPLE_PROJECTS_DIR, 'example', 'manifest.json'), join(dir, 'manifest.json'));
      copyFileSync(join(EXAMPLE_PROJECTS_DIR, 'example', 'bundle.json'), join(dir, 'bundle.json'));
      return dir;
    };
    try {
      // (1) A bundle WITHOUT a media/ dir imports its content cleanly even with a mediaRoot set.
      const db1 = await makeTestDb();
      const admin1 = await registerAccount(db1, 'edge1@test.local', 'Pw-secret-1', { platformRole: 'admin' });
      const noMedia = await importSeedBundle({ db: db1, userId: admin1.userId, dir: contentOnlyCopy('no-media'), mediaRoot: join(work, 'root1') });
      expect(noMedia.slug).toBe('example');
      expect(noMedia.mediaFiles).toBe(0);

      // (2) Unreadable media entries are skipped per-file (no log passed — the noop default absorbs
      // the warning): an asset id that is a plain FILE, and an asset whose only entry is a dotfile
      // (rejected by the zip-slip guard). The content import itself still succeeds.
      const badMedia = contentOnlyCopy('bad-media');
      mkdirSync(join(badMedia, 'media'));
      writeFileSync(join(badMedia, 'media', 'afile'), 'not a directory');
      mkdirSync(join(badMedia, 'media', 'QQQQ01'));
      writeFileSync(join(badMedia, 'media', 'QQQQ01', '.hidden'), 'dotfiles never restore');
      const db2 = await makeTestDb();
      const admin2 = await registerAccount(db2, 'edge2@test.local', 'Pw-secret-1', { platformRole: 'admin' });
      const bad = await importSeedBundle({ db: db2, userId: admin2.userId, dir: badMedia, mediaRoot: join(work, 'root2') });
      expect(bad.mediaFiles).toBe(0); // nothing restorable — but nothing thrown either
      expect(bad.counts.pages).toBeGreaterThan(0);
    } finally {
      rmSync(work, { recursive: true, force: true }); // don't leak the temp tree
    }
  });
});
