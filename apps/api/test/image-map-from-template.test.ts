import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ImageMap, MediaAsset } from '@sitewright/schema';
import { IMAGE_MAP_TEMPLATES } from '@sitewright/schema';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// Integration: materialising a bundled image-map template into a project. The point of the route is
// that the resulting map is SELF-CONTAINED — the template's images are copied into the project's own
// media library and the config rewritten to match — so a published site never points back at
// /authoring/imagemaps/.

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-imap-tpl-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

let slugCounter = 0;
async function setup(email: string) {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Site', slug: `imap-${slugCounter++}` },
  });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

const fromTemplate = (t: string, projectId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/imagemaps/from-template`, cookies: { sw_session: t }, payload });

describe('the bundled template catalog routes', () => {
  it('lists the templates without auth (static platform data)', async () => {
    const res = await app.inject({ method: 'GET', url: '/authoring/imagemaps' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { templates: unknown[] }).templates).toHaveLength(IMAGE_MAP_TEMPLATES.length);
  });

  it('serves one template config, and 404s an unknown id', async () => {
    const ok = await app.inject({ method: 'GET', url: '/authoring/imagemaps/templates/business' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { config: { artboards: unknown[] } }).config.artboards.length).toBeGreaterThan(0);

    expect((await app.inject({ method: 'GET', url: '/authoring/imagemaps/templates/nope' })).statusCode).toBe(404);
  });

  it('serves a template image, and 404s anything not in the catalog', async () => {
    const ok = await app.inject({ method: 'GET', url: '/authoring/imagemaps/v6-real-estate-4.jpg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.rawPayload.length).toBeGreaterThan(1000);

    expect((await app.inject({ method: 'GET', url: '/authoring/imagemaps/not-a-file.jpg' })).statusCode).toBe(404);
  });
});

describe('POST /projects/:id/imagemaps/from-template', () => {
  it('self-hosts a template that carries images', async () => {
    const { t, projectId } = await setup('imap-a@x.test');
    const res = await fromTemplate(t, projectId, { template: 'real-estate' });
    expect(res.statusCode).toBe(201);

    const { item, importedImages } = res.json() as { item: ImageMap; importedImages: number };
    expect(importedImages).toBe(2);

    // Nothing may still point at the platform's own copies.
    const raw = JSON.stringify(item);
    expect(raw).not.toContain('/authoring/imagemaps/');
    expect(raw).not.toContain('cloudfront');
    expect(raw).toContain('/media/');

    // …and the media library really holds them.
    const media = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
    const items = (media.json() as { items: MediaAsset[] }).items;
    expect(items).toHaveLength(2);
    for (const asset of items) expect(raw).toContain(asset.url);
  });

  it('imports nothing for a pure-SVG template', async () => {
    const { t, projectId } = await setup('imap-b@x.test');
    const res = await fromTemplate(t, projectId, { template: 'business' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { importedImages: number }).importedImages).toBe(0);
  });

  it('gives every artboard a unique id, so the floor switcher works', async () => {
    // The vendor export omits the id on its FIRST artboard; without one every artboard shares
    // artboardDefaults' `default-id` and a change-artboard action silently does nothing.
    const { t, projectId } = await setup('imap-c@x.test');
    const res = await fromTemplate(t, projectId, { template: 'real-estate' });
    const map = (res.json() as { item: ImageMap }).item;
    const ids = map.artboards.map((a) => a.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honours an explicit id and name, and defaults both otherwise', async () => {
    const { t, projectId } = await setup('imap-d@x.test');
    const named = await fromTemplate(t, projectId, { template: 'business', id: 'my-chart', name: 'Q3 split' });
    const a = (named.json() as { item: ImageMap }).item;
    expect(a.id).toBe('my-chart');
    expect(a.general.name).toBe('Q3 split');

    const auto = (await fromTemplate(t, projectId, { template: 'business' })).json() as { item: ImageMap };
    expect(auto.item.id).toMatch(/^business-[0-9a-f]{8}$/);
    expect(auto.item.general.name).toBe('Business');
  });

  it('stores it as retrievable imagemap content', async () => {
    const { t, projectId } = await setup('imap-e@x.test');
    await fromTemplate(t, projectId, { template: 'engineering', id: 'engine' });
    const got = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/imagemap/engine`,
      cookies: { sw_session: t },
    });
    expect(got.statusCode).toBe(200);
    expect((got.json() as { item: ImageMap }).item.general.name).toBe('Engineering diagram');
  });

  it('404s an unknown template and 400s a malformed body', async () => {
    const { t, projectId } = await setup('imap-f@x.test');
    expect((await fromTemplate(t, projectId, { template: 'nope' })).statusCode).toBe(404);
    expect((await fromTemplate(t, projectId, {})).statusCode).toBe(400);
    // A traversal attempt is just an unknown template — the catalog is an allowlist.
    expect((await fromTemplate(t, projectId, { template: '../../../etc/passwd' })).statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const { projectId } = await setup('imap-g@x.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/imagemaps/from-template`,
      payload: { template: 'business' },
    });
    expect(res.statusCode).toBe(401);
  });
});
