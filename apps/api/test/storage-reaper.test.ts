import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { reapStaleDirs, reapUnservedBuilds, sweepDerivedStorage, projectStorage } from '../src/repo/storage-reaper.js';
import { content, projects } from '../src/db/schema.js';
import { newId } from '../src/id.js';
import type { Database } from '../src/db/client.js';

const DAY = 24 * 60 * 60 * 1000;

let root: string;
let db: Database;

async function site(store: string, slug: string, ageDays = 0, bytes = 64): Promise<string> {
  const dir = join(root, store, slug);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.html');
  await writeFile(file, 'x'.repeat(bytes));
  if (ageDays) {
    const when = new Date(Date.now() - ageDays * DAY);
    await utimes(file, when, when);
    await utimes(dir, when, when);
  }
  return dir;
}

const slugsIn = async (store: string) => (await readdir(join(root, store))).sort();

async function project(slug: string, opts: { localTarget?: boolean; remoteTarget?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(projects).values({ id, name: slug, slug, createdAt: new Date() });
  const target = async (protocol: string) =>
    db.insert(content).values({
      id: newId(),
      projectId: id,
      kind: 'deploy_target',
      entityId: newId(),
      scope: '',
      data: { protocol },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  if (opts.localTarget) await target('local');
  if (opts.remoteTarget) await target('sftp');
  return id;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-reap-'));
  db = await makeTestDb();
});

describe('reapStaleDirs', () => {
  it('removes what is past the window and keeps what is not', async () => {
    await site('preview', 'old', 40);
    await site('preview', 'fresh', 2);
    const r = await reapStaleDirs(join(root, 'preview'), 30 * DAY);
    expect(r.removed).toEqual(['old']);
    expect(r.bytesFreed).toBeGreaterThan(0);
    expect(await slugsIn('preview')).toEqual(['fresh']);
  });

  it('★ ages a directory by its NEWEST CHILD, not the directory itself', async () => {
    // A rebuild that overwrites the same filenames in place does not necessarily touch the
    // directory's own mtime — on many filesystems that only tracks entries being added or removed.
    // Ageing by the directory alone would reap an actively-rebuilt project as a month stale.
    const dir = await site('preview', 'rebuilt', 40);
    const now = new Date();
    await writeFile(join(dir, 'index.html'), 'rebuilt just now');
    await utimes(join(dir, 'index.html'), now, now); // child fresh, directory still old
    const r = await reapStaleDirs(join(root, 'preview'), 30 * DAY);
    expect(r.removed).toEqual([]);
    expect(await slugsIn('preview')).toEqual(['rebuilt']);
  });

  it('honours `keep`, whatever the age', async () => {
    await site('preview', 'pinned', 400);
    const r = await reapStaleDirs(join(root, 'preview'), 30 * DAY, { keep: new Set(['pinned']) });
    expect(r.removed).toEqual([]);
  });

  it('★ reports the project id of everything it removed, which is what clears the build marker', async () => {
    // Without this the running process keeps believing the build exists — its check returns early on
    // a version match and never tests the directory — and previews 404 until the version changes.
    await site('preview', 'gone', 40);
    const seen: string[] = [];
    await reapStaleDirs(join(root, 'preview'), 30 * DAY, { onRemoved: (s) => seen.push(s) });
    expect(seen).toEqual(['gone']);
  });

  it('is a no-op on a store that was never written to', async () => {
    await expect(reapStaleDirs(join(root, 'never'), 30 * DAY)).resolves.toEqual({ removed: [], bytesFreed: 0 });
  });
});

describe('reapUnservedBuilds', () => {
  it('keeps only what is served, with no age test at all', async () => {
    // A build without a Local Hosting target is unreachable the MOMENT it is written, so waiting
    // 30 days to admit that would just mean carrying it for 30 days.
    await site('sites', 'served', 0);
    await site('sites', 'unserved', 0);
    const r = await reapUnservedBuilds(join(root, 'sites'), new Set(['served']));
    expect(r.removed).toEqual(['unserved']);
    expect(await slugsIn('sites')).toEqual(['served']);
  });

  it('★ never deletes underneath a publish in flight', async () => {
    // The directory is being written right now; rm -rf mid-build would corrupt the release.
    await site('sites', 'building', 0);
    const r = await reapUnservedBuilds(join(root, 'sites'), new Set(), { skip: new Set(['building']) });
    expect(r.removed).toEqual([]);
    expect(await slugsIn('sites')).toEqual(['building']);
  });
});

describe('sweepDerivedStorage', () => {
  it('★ keeps a build for a LOCAL target and drops one for a remote-only project', async () => {
    // data/sites/<slug> is read by exactly one thing — the local /sites/<slug>/ server. A remote
    // deploy builds into a temp dir of its own, so a remote-only project's build there is waste.
    await project('local-site', { localTarget: true });
    await project('remote-site', { remoteTarget: true });
    await project('no-target');
    await site('sites', 'local-site');
    await site('sites', 'remote-site');
    await site('sites', 'no-target');

    const report = await sweepDerivedStorage(db, { publishRoot: join(root, 'sites'), retentionMs: 30 * DAY });

    expect(report.builds.removed.sort()).toEqual(['no-target', 'remote-site']);
    expect(await slugsIn('sites')).toEqual(['local-site']);
  });

  it('maps a reaped preview back to its PROJECT ID for the marker callback', async () => {
    const id = await project('previewed');
    await site('preview', 'previewed', 40);
    const seen: string[] = [];
    await sweepDerivedStorage(db, {
      previewRoot: join(root, 'preview'),
      retentionMs: 30 * DAY,
      onPreviewReaped: (projectId) => seen.push(projectId),
    });
    expect(seen).toEqual([id]); // the project id, not the slug — that is what the map is keyed by
  });

  it('reaps stale source references on the same window', async () => {
    await project('imported');
    await site('source-refs', 'imported', 40);
    const report = await sweepDerivedStorage(db, { sourceRefRoot: join(root, 'source-refs'), retentionMs: 30 * DAY });
    expect(report.sourceRefs.removed).toEqual(['imported']);
  });

  it('retentionMs of 0 disables the AGE-based reapers but not the unserved-build rule', async () => {
    // An operator turning retention off is saying "keep my previews", not "keep builds nothing serves".
    await project('p');
    await site('preview', 'p', 400);
    await site('source-refs', 'p', 400);
    await site('sites', 'p', 400);
    const report = await sweepDerivedStorage(db, {
      publishRoot: join(root, 'sites'),
      previewRoot: join(root, 'preview'),
      sourceRefRoot: join(root, 'source-refs'),
      retentionMs: 0,
    });
    expect(report.previews.removed).toEqual([]);
    expect(report.sourceRefs.removed).toEqual([]);
    expect(report.builds.removed).toEqual(['p']);
  });

  it('★ a SOFT-DELETED project is still a project — its build is judged on its target, not its state', async () => {
    // Soft-delete is restorable. Reaping is fine (everything here is derived) but it must happen for
    // the documented reason, not as a side effect of the project row looking unusual.
    const id = await project('soft', { localTarget: true });
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));
    await site('sites', 'soft');
    const report = await sweepDerivedStorage(db, { publishRoot: join(root, 'sites'), retentionMs: 30 * DAY });
    expect(report.builds.removed).toEqual([]); // it has a local target; restoring it must find its site
  });
});

describe('projectStorage', () => {
  it('measures one project in one store, and refuses a traversal slug', async () => {
    await site('media', 'measured', 0, 4096);
    expect(await projectStorage(join(root, 'media'), 'measured')).toBe(4096);
    expect(await projectStorage(join(root, 'media'), '../../etc')).toBe(0);
    expect(await projectStorage(undefined, 'measured')).toBe(0);
  });
});
