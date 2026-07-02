import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/** Build a project-export zip (manifest + bundle + optional extra media entries) for negative paths. */
async function projectZip(bundle: unknown, slug = 'bad', media: Record<string, string> = {}): Promise<Buffer> {
  const manifest = {
    kind: 'sitewright-project-export',
    exportFormat: 1,
    bundleFormat: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    source: { id: 'p', name: 'Bad', slug },
    mediaSlug: slug,
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('bundle.json', JSON.stringify(bundle));
  for (const [name, content] of Object.entries(media)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const MINIMAL_BUNDLE = {
  formatVersion: 2,
  project: { id: 'p', name: 'Ok', slug: 'ok', identity: { name: 'Ok', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
};

async function projectsOf(app: FastifyInstance, t: string): Promise<string[]> {
  const list = await app.inject({ method: 'GET', url: '/projects', cookies: { sw_session: t } });
  return (list.json() as { projects: Array<{ slug: string }> }).projects.map((p) => p.slug);
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-import-zip-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot, version: 'test-1' });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function staff(email: string): Promise<string> {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  return token(
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }),
  );
}

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWZIPBOUNDARY';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

function doneReport(payload: string): Record<string, unknown> {
  expect(payload).toContain('event: done');
  const frame = payload.slice(payload.lastIndexOf('event: done'));
  const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) throw new Error('no data line in done event');
  return (JSON.parse(dataLine.slice('data:'.length).trim()) as { report: Record<string, unknown> }).report;
}

/** Create a source project with content + one uploaded image, then return its export zip bytes. */
async function seedAndExport(t: string, slug: string): Promise<{ projectId: string; zip: Buffer }> {
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Source', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  const base = `/projects/${projectId}`;
  const cookies = { sw_session: t };
  await app.inject({ method: 'PUT', url: `${base}/content/snippet/hero`, cookies, payload: { id: 'hero', name: 'hero', source: '<div>hi</div>' } });
  await app.inject({ method: 'PUT', url: `${base}/content/dataset/posts`, cookies, payload: { id: 'posts', name: 'Posts', slug: 'posts', fields: [{ name: 'title', type: 'text' }] } });
  await app.inject({ method: 'PUT', url: `${base}/content/entry/p1`, cookies, payload: { id: 'p1', dataset: 'posts', status: 'published', values: { title: 'Hi' } } });
  await app.inject({ method: 'POST', url: `${base}/media`, cookies, ...multipart('red.png', 'image/png', PNG_1X1) });
  const exp = await app.inject({ method: 'GET', url: `${base}/export.zip`, cookies });
  expect(exp.statusCode).toBe(200);
  return { projectId, zip: exp.rawPayload };
}

describe('POST /projects/import/zip', () => {
  it('imports a project export zip as a NEW project (deduped slug, rewritten media URLs)', async () => {
    const t = await staff('dev@test.local');
    const { zip } = await seedAndExport(t, 'site');

    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('site-export.zip', 'application/zip', zip),
    });
    expect(res.statusCode).toBe(200);
    const report = doneReport(res.payload);
    expect(report.slug).toBe('site-2'); // original slug 'site' is taken → deduped
    expect(report.media as number).toBeGreaterThan(0); // count of extracted media FILES (image variants)
    const newId = report.projectId as string;

    // The new project carries the content…
    const cookies = { sw_session: t };
    const snippets = await app.inject({ method: 'GET', url: `/projects/${newId}/content/snippet`, cookies });
    expect((snippets.json() as { items: unknown[] }).items).toHaveLength(1);

    // …and its media URL + binary are rewritten to the NEW slug.
    const mediaList = await app.inject({ method: 'GET', url: `/projects/${newId}/media`, cookies });
    const assets = (mediaList.json() as { items: Array<{ id: string; url: string }> }).items;
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(asset.url.startsWith('/media/site-2/')).toBe(true);
    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.statusCode).toBe(200);

    // The source project is untouched.
    const sources = await app.inject({ method: 'GET', url: `/projects`, cookies });
    const all = (sources.json() as { projects: Array<{ slug: string }> }).projects.map((p) => p.slug).sort();
    expect(all).toEqual(['site', 'site-2']);
  });

  it('round-trips DATASET-SCOPED entry ids — two datasets share id `intro` (post-#595)', async () => {
    const t = await staff('dsround@test.local');
    const cookies = { sw_session: t };
    // Source: two datasets, each holding an entry with the SAME id `intro` (only unique per-dataset).
    const proj = await app.inject({ method: 'POST', url: '/projects', cookies, payload: { name: 'DS', slug: 'ds' } });
    const projectId = (proj.json() as { project: { id: string } }).project.id;
    const base = `/projects/${projectId}`;
    for (const slug of ['team', 'services']) {
      await app.inject({ method: 'PUT', url: `${base}/content/dataset/${slug}`, cookies, payload: { id: slug, name: slug, slug, fields: [{ name: 'title', type: 'text' }] } });
      await app.inject({ method: 'PUT', url: `${base}/content/entry/intro`, cookies, payload: { id: 'intro', dataset: slug, status: 'published', values: { title: `${slug} intro` } } });
    }

    const exp = await app.inject({ method: 'GET', url: `${base}/export.zip`, cookies });
    expect(exp.statusCode).toBe(200);
    // The exported bundle carries BOTH `intro` rows (distinct scopes) — no id collapse.
    const zip = await JSZip.loadAsync(exp.rawPayload);
    const bundle = JSON.parse(await zip.file('bundle.json')!.async('string')) as { entries: Array<{ id: string; dataset: string }> };
    expect(bundle.entries.filter((e) => e.id === 'intro').map((e) => e.dataset).sort()).toEqual(['services', 'team']);

    // Import as a NEW project → both scoped entries survive, each resolvable by its dataset.
    const res = await app.inject({ method: 'POST', url: '/projects/import/zip', cookies, ...multipart('ds.zip', 'application/zip', exp.rawPayload) });
    expect(res.statusCode).toBe(200);
    const report = doneReport(res.payload);
    expect(typeof report.projectId).toBe('string');
    const newId = report.projectId as string;
    const nbase = `/projects/${newId}`;
    const team = await app.inject({ method: 'GET', url: `${nbase}/content/entry/intro?dataset=team`, cookies });
    const services = await app.inject({ method: 'GET', url: `${nbase}/content/entry/intro?dataset=services`, cookies });
    expect(team.statusCode).toBe(200);
    expect(services.statusCode).toBe(200);
    expect((team.json() as { item: { values: { title: string } } }).item.values.title).toBe('team intro');
    expect((services.json() as { item: { values: { title: string } } }).item.values.title).toBe('services intro');
  });

  it('rejects a non-zip upload with 400 (before hijacking the stream)', async () => {
    const t = await staff('dev2@test.local');
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('notes.txt', 'text/plain', Buffer.from('not a zip')),
    });
    expect(res.statusCode).toBe(400);
  });

  it('forbids a non-staff user (403)', async () => {
    await registerAccount(db, 'client@test.local', 'Pw-secret-1'); // no platform role → not staff
    const t = token(
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@test.local', password: 'Pw-secret-1' } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('x.zip', 'application/zip', Buffer.from('PK')),
    });
    expect(res.statusCode).toBe(403);
  });

  it('rolls back a project whose bundle fails integrity checks (nothing left behind)', async () => {
    const t = await staff('dev5@test.local');
    // A page bound to a non-existent dataset passes the schema but fails validateProject.
    const bad = await projectZip({
      formatVersion: 2,
      project: { id: 'p', name: 'Bad', slug: 'bad', identity: { name: 'Bad', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
      pages: [{ id: 'x', path: '[slug]', title: 'X', collection: { dataset: 'ghost', param: 'slug' } }],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('bad.zip', 'application/zip', bad),
    });
    expect(res.payload).toContain('event: error');
    // The half-built project was removed on rollback — no 'bad' slug lingers.
    const list = await app.inject({ method: 'GET', url: '/projects', cookies: { sw_session: t } });
    const slugs = (list.json() as { projects: Array<{ slug: string }> }).projects.map((p) => p.slug);
    expect(slugs).not.toContain('bad');
  });

  it('rolls back when media extraction fails (bad asset id in the archive)', async () => {
    const t = await staff('dev7@test.local');
    // Bundle imports fine, but a media entry has an invalid asset-id segment → importAssetFile throws.
    const bad = await projectZip(MINIMAL_BUNDLE, 'okmedia', { 'media/bad.id/x.webp': 'data' });
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('m.zip', 'application/zip', bad),
    });
    expect(res.payload).toContain('event: error');
    expect(await projectsOf(app, t)).not.toContain('okmedia');
  });

  it('rejects a bundle whose media points at another project (cross-tenant)', async () => {
    const t = await staff('dev8@test.local');
    const bundle = {
      formatVersion: 2,
      project: { id: 'p', name: 'X', slug: 'evil', identity: { name: 'X', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
      media: [{ kind: 'file', id: 'a1', filename: 'd.pdf', folder: '', bytes: 1, contentType: 'application/pdf', storedName: 'd.pdf', url: '/media/victim/a1/file/d.pdf' }],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/projects/import/zip',
      cookies: { sw_session: t },
      ...multipart('evil.zip', 'application/zip', await projectZip(bundle, 'evil')),
    });
    expect(res.payload).toContain('event: error');
    expect(await projectsOf(app, t)).not.toContain('evil');
  });

  it('caps concurrent imports (some requests get 429)', async () => {
    const t = await staff('dev9@test.local');
    const { zip } = await seedAndExport(t, 'conc');
    // Fire 3 imports at once; MAX_CONCURRENT_PROJECT_IMPORTS is 2 → at least one 429.
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: '/projects/import/zip',
          cookies: { sw_session: t },
          ...multipart('conc.zip', 'application/zip', zip),
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 when media storage is not configured', async () => {
    await app.close();
    app = await createApp({ db, version: 'test-1' }); // no mediaRoot → mediaStorage undefined
    await app.ready();
    const t = await staff('dev6@test.local');
    // The !mediaStorage guard is hit before any file parsing (the multipart plugin is not
    // registered without media storage), so a plain POST reaches it.
    const res = await app.inject({ method: 'POST', url: '/projects/import/zip', cookies: { sw_session: t } });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /projects/:id/duplicate', () => {
  it('clones a project in-instance (new slug, copied media, original untouched)', async () => {
    const t = await staff('dev3@test.local');
    const { projectId } = await seedAndExport(t, 'orig');
    const cookies = { sw_session: t };

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/duplicate`, cookies });
    expect(res.statusCode).toBe(201);
    const copy = (res.json() as { project: { id: string; slug: string; name: string } }).project;
    expect(copy.slug).toBe('orig-2');
    expect(copy.name).toContain('(copy)');

    // The copy has the media, served under its own slug.
    const mediaList = await app.inject({ method: 'GET', url: `/projects/${copy.id}/media`, cookies });
    const asset = (mediaList.json() as { items: Array<{ url: string }> }).items[0]!;
    expect(asset.url.startsWith('/media/orig-2/')).toBe(true);
    expect((await app.inject({ method: 'GET', url: asset.url })).statusCode).toBe(200);
  });

  it('forbids a non-staff user (403)', async () => {
    const t = await staff('dev4@test.local');
    const { projectId } = await seedAndExport(t, 'p');
    await registerAccount(db, 'nostaff@test.local', 'Pw-secret-1');
    const other = token(
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nostaff@test.local', password: 'Pw-secret-1' } }),
    );
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/duplicate`, cookies: { sw_session: other } });
    expect(res.statusCode).toBe(403);
  });
});
