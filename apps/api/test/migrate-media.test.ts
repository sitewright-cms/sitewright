import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { content, contentRevisions } from '../src/db/schema.js';
import { MediaStorage } from '../src/media/storage.js';
import { isShortAssetId } from '../src/id.js';
import { migrateMediaToFlatShortId, deriveShortId } from '../src/media/migrate-media.js';

// Legacy uuid-shaped ids (36 chars, hyphenated) → the migration must convert these to short flat ids.
const IMG = '3f8a1c2e-9b4d-4e6a-8c1f-000000000001';
const FONT = '3f8a1c2e-9b4d-4e6a-8c1f-000000000002';
const FILE = '3f8a1c2e-9b4d-4e6a-8c1f-000000000003';

let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;
let storage: MediaStorage;

beforeEach(async () => {
  db = await makeTestDb();
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-migrate-media-'));
  storage = new MediaStorage(mediaRoot);
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

async function makeProject(): Promise<string> {
  const app = await createApp({ db, mediaRoot });
  await registerAccount(db, 'dev@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dev@acme.test', password: 'Pw-secret-1' } })).cookies.find(
    (c) => c.name === 'sw_session',
  )!.value;
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'P', slug: 'p' } })).json() as {
    project: { id: string };
  }).project.id;
  await app.close();
  return pid;
}

/** Raw-insert a content row (bypassing schema) to plant legacy-shaped data. */
async function rawPut(pid: string, kind: string, entityId: string, data: unknown, deletedAt?: Date): Promise<void> {
  await db.insert(content).values({
    id: `raw-${kind}-${entityId}`,
    projectId: pid,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kind: kind as any,
    entityId,
    scope: '',
    data,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(deletedAt ? { deletedAt } : {}),
  });
}
async function rowOf(pid: string, kind: string, entityId: string): Promise<{ data: Record<string, unknown>; deletedAt: Date | null } | undefined> {
  const [r] = await db
    .select()
    .from(content)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(and(eq(content.projectId, pid), eq(content.kind, kind as any), eq(content.entityId, entityId)));
  return r ? { data: r.data as Record<string, unknown>, deletedAt: r.deletedAt } : undefined;
}
async function allMedia(pid: string): Promise<Array<{ entityId: string; data: Record<string, unknown>; deletedAt: Date | null }>> {
  const rows = await db.select().from(content).where(and(eq(content.projectId, pid), eq(content.kind, 'media')));
  return rows.map((r) => ({ entityId: r.entityId, data: r.data as Record<string, unknown>, deletedAt: r.deletedAt }));
}

async function seedLegacyProject(): Promise<string> {
  const pid = await makeProject();
  // --- media records (legacy 3-segment urls) ---
  await rawPut(pid, 'media', IMG, {
    kind: 'image', id: IMG, filename: 'photo.png', folder: '', format: 'png', bytes: 100, width: 10, height: 10,
    hasAlpha: false, animated: false, original: 'photo.png', url: `/media/p/${IMG}/photo.png`,
  });
  await rawPut(pid, 'media', FONT, {
    kind: 'font', id: FONT, filename: 'Inter', folder: '', bytes: 6, family: 'Inter', fallback: 'sans-serif',
    source: 'local', files: [{ weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' }],
    url: `/media/p/${FONT}/inter-400.woff2`,
  });
  // A SOFT-DELETED raw file (recycle bin) — must still migrate, keeping its deletedAt.
  await rawPut(pid, 'media', FILE, {
    kind: 'file', id: FILE, filename: 'report.pdf', folder: '', bytes: 9, contentType: 'application/pdf',
    storedName: 'report.pdf', url: `/media/p/${FILE}/file/report.pdf`,
  }, new Date());

  // --- on-disk binaries in the legacy foldered layout ---
  await storage.storeFile('p', IMG, 'photo.png', Buffer.from('PNGDATA'));
  await storage.storeFile('p', FONT, 'inter-400.woff2', Buffer.from('FONTBY'));
  await storage.storeFile('p', FILE, 'report.pdf', Buffer.from('%PDF-1.4'));

  // --- a page that references the image via its legacy delivery url ---
  await rawPut(pid, 'page', 'about', {
    id: 'about', path: 'about', title: 'About',
    source: `<section><img src="/media/p/${IMG}/photo.png?size=lg"></section>`,
  });
  // --- a revision snapshot that also references it (must be rewritten so a restore resolves) ---
  await db.insert(contentRevisions).values({
    id: 'rev-about-1', projectId: pid, kind: 'page', entityId: 'about', scope: '',
    data: { id: 'about', path: 'about', title: 'About', source: `<img src="/media/p/${IMG}/photo.png">` },
    op: 'put', userId: 'u1', actor: 'user', revisionAt: new Date(),
  });
  // --- settings whose typography slot references the font by BARE assetId (the project seed already
  //     created a settings row, so UPDATE its data blob rather than insert a colliding row) ---
  await db
    .update(content)
    .set({
      data: {
        identity: {
          name: 'P', colors: { primary: '#0a7' },
          typography: { fontFamilies: {}, heading: { source: 'asset', family: 'Inter', weight: 400, assetId: FONT } },
          image: `/media/p/${IMG}/photo.png`, // the OG image references the (legacy) image url too
        },
        settings: { defaultLocale: 'en', locales: ['en'] },
      },
    })
    .where(and(eq(content.projectId, pid), eq(content.kind, 'settings'), eq(content.entityId, 'settings')));
  return pid;
}

describe('migrateMediaToFlatShortId', () => {
  it('re-keys legacy media to flat short ids, moves binaries, and rewrites every reference', async () => {
    const pid = await seedLegacyProject();
    let snapshots = 0;
    await migrateMediaToFlatShortId(db, storage, { snapshot: async () => void (snapshots += 1) });
    expect(snapshots).toBe(1); // snapshotted once before the first rewrite

    // Every media record is now a SHORT flat id with a flat url.
    const media = await allMedia(pid);
    expect(media).toHaveLength(3);
    for (const m of media) {
      expect(isShortAssetId(m.entityId)).toBe(true);
      expect(m.data.id).toBe(m.entityId);
      expect(m.data.url as string).toMatch(new RegExp(`^/media/p/${m.entityId}-`));
    }
    const img = media.find((m) => m.data.original === 'photo.png')!;
    const font = media.find((m) => (m.data.family as string) === 'Inter')!;
    const file = media.find((m) => (m.data.storedName as string) === 'report.pdf')!;

    // The soft-deleted file keeps its deletedAt (still in the recycle bin after migration).
    expect(file.deletedAt).not.toBeNull();
    expect(file.data.url).toBe(`/media/p/${file.entityId}-report.pdf`); // `/file/` segment dropped

    // Binaries moved to the flat layout; the legacy dirs are gone.
    expect(existsSync(join(mediaRoot, 'p', `${img.entityId}-photo.png`))).toBe(true);
    expect(existsSync(join(mediaRoot, 'p', `${font.entityId}-inter-400.woff2`))).toBe(true);
    expect(existsSync(join(mediaRoot, 'p', `${file.entityId}-report.pdf`))).toBe(true);
    expect(existsSync(join(mediaRoot, 'p', IMG))).toBe(false);
    expect(existsSync(join(mediaRoot, 'p', FONT))).toBe(false);

    // Page + its revision rewritten to the flat url (no legacy uuid ref remains).
    const page = (await rowOf(pid, 'page', 'about'))!;
    expect(page.data.source as string).toContain(`/media/p/${img.entityId}-photo.png?size=lg`);
    expect(page.data.source as string).not.toContain(IMG);
    const [rev] = await db.select().from(contentRevisions).where(eq(contentRevisions.id, 'rev-about-1'));
    expect((rev!.data as { source: string }).source).toContain(`/media/p/${img.entityId}-photo.png`);

    // Settings: the bare font-slot assetId + the og image url are both remapped.
    const settings = (await rowOf(pid, 'settings', 'settings'))!;
    const identity = settings.data.identity as { typography: { heading: { assetId: string } }; image: string };
    expect(identity.typography.heading.assetId).toBe(font.entityId);
    expect(identity.image).toBe(`/media/p/${img.entityId}-photo.png`);
  });

  it('is idempotent — a second run changes nothing and takes no snapshot', async () => {
    const pid = await seedLegacyProject();
    await migrateMediaToFlatShortId(db, storage);
    const first = await allMedia(pid);
    const firstRev = (await db.select().from(contentRevisions).where(eq(contentRevisions.id, 'rev-about-1')))[0]!.data;

    let snapshots = 0;
    await migrateMediaToFlatShortId(db, storage, { snapshot: async () => void (snapshots += 1) });
    expect(snapshots).toBe(0); // nothing to migrate → no snapshot, no work

    const second = await allMedia(pid);
    expect(second.map((m) => m.entityId).sort()).toEqual(first.map((m) => m.entityId).sort());
    expect((await db.select().from(contentRevisions).where(eq(contentRevisions.id, 'rev-about-1')))[0]!.data).toEqual(firstRev);
  });

  it('leaves references to unmapped / foreign assets untouched', async () => {
    const pid = await makeProject();
    // One legacy asset (so the project IS migrated) + its binary.
    await rawPut(pid, 'media', IMG, {
      kind: 'image', id: IMG, filename: 'p.png', folder: '', format: 'png', bytes: 1, width: 1, height: 1,
      hasAlpha: false, animated: false, original: 'p.png', url: `/media/p/${IMG}/p.png`,
    });
    await storage.storeFile('p', IMG, 'p.png', Buffer.from('X'));
    // A page referencing the legacy asset (mapped) AND a dangling foreign id not in this project's media.
    const FOREIGN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await rawPut(pid, 'page', 'about', {
      id: 'about', path: 'about', title: 'A',
      source: `<img src="/media/p/${IMG}/p.png"><img src="/media/p/${FOREIGN}/z.png">`,
    });
    // Settings with an assetId that isn't in the id map.
    await db
      .update(content)
      .set({
        data: {
          identity: { name: 'P', colors: { primary: '#0a7' }, typography: { fontFamilies: {}, heading: { source: 'asset', family: 'X', weight: 400, assetId: 'unmapped999' } } },
          settings: { defaultLocale: 'en', locales: ['en'] },
        },
      })
      .where(and(eq(content.projectId, pid), eq(content.kind, 'settings'), eq(content.entityId, 'settings')));

    await migrateMediaToFlatShortId(db, storage);

    const img = (await allMedia(pid)).find((m) => m.data.original === 'p.png')!;
    const page = (await rowOf(pid, 'page', 'about'))!;
    expect(page.data.source as string).toContain(`/media/p/${img.entityId}-p.png`); // mapped → rewritten
    expect(page.data.source as string).toContain(`/media/p/${FOREIGN}/z.png`); // unmapped → untouched
    const settings = (await rowOf(pid, 'settings', 'settings'))!;
    expect((settings.data.identity as { typography: { heading: { assetId: string } } }).typography.heading.assetId).toBe('unmapped999');
  });

  it('converges from a crash BETWEEN reference-rewrite and re-key (refs flat, row still legacy)', async () => {
    const pid = await makeProject();
    await rawPut(pid, 'media', IMG, {
      kind: 'image', id: IMG, filename: 'p.png', folder: '', format: 'png', bytes: 1, width: 1, height: 1,
      hasAlpha: false, animated: false, original: 'p.png', url: `/media/p/${IMG}/p.png`,
    });
    await storage.storeFile('p', IMG, 'p.png', Buffer.from('X'));
    // Simulate the exact half-done state a crash after step 1+2 (copy + rewrite refs), before step 3
    // (re-key), leaves: the binary is already copied flat, the page ref is already the flat url, but the
    // media ROW is still on the legacy id. The migration must re-process it (row still legacy → in scope)
    // and converge — NOT leave it stuck.
    const newId = deriveShortId(IMG);
    await storage.copyAsset('p', IMG, newId); // step 1 (done pre-crash)
    await rawPut(pid, 'page', 'about', { id: 'about', path: 'about', title: 'A', source: `<img src="/media/p/${newId}-p.png">` }); // step 2 (done)

    await migrateMediaToFlatShortId(db, storage);

    // Row re-keyed to the SAME derived id; page ref unchanged (already flat, not double-rewritten).
    const [m] = await allMedia(pid);
    expect(m!.entityId).toBe(newId);
    expect(m!.data.url).toBe(`/media/p/${newId}-p.png`);
    expect((await rowOf(pid, 'page', 'about'))!.data.source).toBe(`<img src="/media/p/${newId}-p.png">`);
    // Binary at the flat path; the legacy dir cleaned up.
    expect(existsSync(join(mediaRoot, 'p', `${newId}-p.png`))).toBe(true);
    expect(existsSync(join(mediaRoot, 'p', IMG))).toBe(false);
  });

  it('skips a project that has no legacy media (already flat)', async () => {
    const pid = await makeProject();
    await rawPut(pid, 'media', 'a1B2c3', {
      kind: 'image', id: 'a1B2c3', filename: 'x.png', folder: '', format: 'png', bytes: 1, width: 1, height: 1,
      hasAlpha: false, animated: false, original: 'x.png', url: '/media/p/a1B2c3-x.png',
    });
    let snapshots = 0;
    await migrateMediaToFlatShortId(db, storage, { snapshot: async () => void (snapshots += 1) });
    expect(snapshots).toBe(0);
    const [m] = await allMedia(pid);
    expect(m!.entityId).toBe('a1B2c3'); // unchanged
  });
});
