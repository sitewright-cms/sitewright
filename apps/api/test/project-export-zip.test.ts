import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { ProjectExportBundleSchema, ExportManifestSchema } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-export-zip-'));
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

async function setup(email: string, slug = 'site') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }),
  );
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId, slug };
}

function multipart(filename: string, mime: string, content: Buffer) {
  const boundary = 'SWTESTBOUNDARY';
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

describe('GET /projects/:id/export.zip', () => {
  it('streams a self-contained zip: manifest + complete bundle + media binaries', async () => {
    const { t, projectId, slug } = await setup('dev@test.local');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    // A page + a snippet + an uploaded image (real binaries on disk).
    await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies,
      payload: { id: 'home', path: '', title: 'Home' },
    });
    await app.inject({
      method: 'PUT',
      url: `${base}/content/snippet/hero`,
      cookies,
      payload: { id: 'hero', name: 'hero', source: '<div>hi</div>' },
    });
    const up = await app.inject({
      method: 'POST',
      url: `${base}/media`,
      cookies,
      ...multipart('red.png', 'image/png', PNG_1X1),
    });
    expect([200, 201]).toContain(up.statusCode);

    const res = await app.inject({ method: 'GET', url: `${base}/export.zip`, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(`${slug}-export.zip`);
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);

    const zip = await JSZip.loadAsync(res.rawPayload);
    // manifest.json validates + records the source slug for media-URL rewrites.
    const manifest = ExportManifestSchema.parse(
      JSON.parse(await zip.file('manifest.json')!.async('string')),
    );
    expect(manifest.kind).toBe('sitewright-project-export');
    expect(manifest.mediaSlug).toBe(slug);
    expect(manifest.app).toBe('test-1');
    expect(manifest.counts?.media).toBe(1);
    expect(manifest.omitted).toContain('deploy_target_credentials');

    // bundle.json is the COMPLETE, re-validatable bundle.
    const bundle = ProjectExportBundleSchema.parse(
      JSON.parse(await zip.file('bundle.json')!.async('string')),
    );
    expect(bundle.pages.map((p) => p.id)).toEqual(['home']);
    expect(bundle.snippets.map((s) => s.name)).toEqual(['hero']);
    expect(bundle.media).toHaveLength(1);
    const assetId = bundle.media[0]!.id;

    // At least one media binary is present under media/<assetId>/…
    const mediaEntries = Object.keys(zip.files).filter((n) => n.startsWith(`media/${assetId}/`));
    expect(mediaEntries.length).toBeGreaterThan(0);
  });

  it('ships the retained original but SKIPS the on-demand thumbnail cache (post-#590)', async () => {
    const { t, projectId } = await setup('thumb@test.local', 'thumbsite');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const up = await app.inject({
      method: 'POST',
      url: `${base}/media`,
      cookies,
      ...multipart('photo.png', 'image/png', PNG_1X1),
    });
    expect([200, 201]).toContain(up.statusCode);
    const asset = (up.json() as { item: { id: string; original: string; url: string } }).item;

    // Hit the on-demand thumbnailer so a derived `<stem>-sm.webp` is cached INTO the asset dir —
    // the exact scenario that used to bleed regenerable thumbnails into the export. Uses the asset's
    // own (flat) delivery url — a new short-id asset is only served by the flat route.
    const thumb = await app.inject({
      method: 'GET',
      url: `${asset.url}?size=sm`,
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toContain('image/webp');

    const res = await app.inject({ method: 'GET', url: `${base}/export.zip`, cookies });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    // Actual files only (JSZip adds an implicit `media/<id>/` directory entry).
    const names = Object.keys(zip.files).filter((n) => n.startsWith(`media/${asset.id}/`) && !zip.files[n]!.dir);
    // The retained ORIGINAL travels…
    expect(names).toContain(`media/${asset.id}/${asset.original}`);
    // …but the regenerable thumbnail cache does NOT.
    expect(names.some((n) => /-(sm|md|lg|xl)\.(webp|avif)$/.test(n))).toBe(false);
    expect(names).toHaveLength(1);
  });

  it('exports a media-less project as a valid zip (manifest + bundle only)', async () => {
    const { t, projectId } = await setup('dev2@test.local', 'site2');
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/export.zip`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    expect(zip.file('manifest.json')).not.toBeNull();
    expect(zip.file('bundle.json')).not.toBeNull();
    expect(Object.keys(zip.files).some((n) => n.startsWith('media/'))).toBe(false);
  });

  it('returns 413 when the archive would exceed the configured size cap', async () => {
    // Rebuild the app with a 1-byte export cap so any archive trips the limit.
    await app.close();
    app = await createApp({ db, mediaRoot, version: 'test-1', exportMaxBytes: 1 });
    await app.ready();
    const { t, projectId } = await setup('tiny@test.local', 'tinycap');
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/page/home`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/export.zip`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(413);
  });

  it('exports even when media storage is disabled (no mediaRoot)', async () => {
    await app.close();
    app = await createApp({ db, version: 'test-1' }); // no mediaRoot → mediaStorage undefined
    await app.ready();
    const { t, projectId } = await setup('nomedia@test.local', 'nomedia');
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/export.zip`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    expect(zip.file('bundle.json')).not.toBeNull();
    expect(Object.keys(zip.files).some((n) => n.startsWith('media/'))).toBe(false);
  });

  it('denies a non-member (404 — project not visible)', async () => {
    const { projectId } = await setup('owner@test.local', 'site3');
    await registerAccount(db, 'stranger@test.local', 'Pw-secret-1', { platformRole: 'developer' });
    const other = token(
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'stranger@test.local', password: 'Pw-secret-1' },
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/export.zip`,
      cookies: { sw_session: other },
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
