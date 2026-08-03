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

describe('image maps are sanitised AT REST, not only at render', () => {
  // The render sink already cleans a config on the way out, which protects the published page. This
  // covers everything that is NOT the page renderer: the Studio reads a map back to edit it,
  // get_content hands one to an agent, and an export ships one to another instance. writeRow is the
  // single low-level write, so put(), the bundle import and a revision restore all pass through it.
  const dirty = (over: Record<string, unknown> = {}) => ({
    id: 'dirty',
    general: { name: 'Dirty' },
    artboards: [
      {
        id: 'ab1',
        title: 'A',
        background_type: 'color' as const,
        image_url: '',
        children: [
          {
            id: 'o1',
            title: 'Region',
            type: 'rect' as const,
            x: 1,
            y: 1,
            width: 10,
            height: 10,
            tooltip_content: [
              { type: 'Paragraph' as const, text: '<b>keep</b><script>bad()</script><i onclick="x()">i</i>' },
              { type: 'YouTube' as const, embedCode: '<iframe src="javascript:bad()"></iframe>' },
            ],
          },
          {
            id: 'o2',
            title: 'Shape',
            type: 'svg' as const,
            x: 20,
            y: 20,
            width: 10,
            height: 10,
            svg: {
              tagName: 'path' as const,
              properties: [
                { name: 'd', value: 'M0 0 L9 9' },
                { name: 'onload', value: 'bad()' },
              ],
            },
          },
        ],
      },
    ],
    ...over,
  });

  async function store(email: string) {
    const { t, projectId } = await setup(email);
    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/imagemap/dirty`,
      cookies: { sw_session: t },
      payload: dirty(),
    });
    expect(put.statusCode).toBe(200);
    const got = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/imagemap/dirty`,
      cookies: { sw_session: t },
    });
    return { t, projectId, item: (got.json() as { item: ImageMap }).item };
  }

  it('strips script and inline handlers from tooltip rich text before storing', async () => {
    const { item } = await store('imap-s1@x.test');
    const raw = JSON.stringify(item);
    expect(raw).not.toContain('<script');
    expect(raw).not.toContain('onclick');
    // …while keeping the markup that is the point of a rich-text block.
    expect(raw).toContain('keep');
  });

  it('neutralises a javascript: embed before storing', async () => {
    const { item } = await store('imap-s2@x.test');
    expect(JSON.stringify(item)).not.toContain('javascript:');
  });

  it('strips a handler attribute from an svg hotspot’s construction spec', async () => {
    const { item } = await store('imap-s3@x.test');
    const shape = item.artboards[0]!.children!.find((c) => c.id === 'o2')!;
    expect(shape.svg?.properties?.map((p) => p.name)).toEqual(['d']);
  });

  it('leaves a clean map byte-identical, so a re-save never degrades it', async () => {
    const { t, projectId, item } = await store('imap-s4@x.test');
    const again = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/imagemap/dirty`,
      cookies: { sw_session: t },
      payload: item,
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { item: ImageMap }).item).toEqual(item);
  });

  it('sanitises a map that arrives through a project IMPORT too', async () => {
    // Import writes rows directly rather than through put(); both funnel through writeRow.
    const { t, projectId } = await setup('imap-s5@x.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/import`,
      cookies: { sw_session: t },
      payload: {
        formatVersion: 2,
        pages: [],
        templates: [],
        datasets: [],
        entries: [],
        snippets: [],
        translations: [],
        forms: [],
        imageMaps: [dirty()],
        media: [],
        mediaFolders: [],
      },
    });
    expect([200, 201]).toContain(res.statusCode);
    const got = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/imagemap/dirty`,
      cookies: { sw_session: t },
    });
    expect(JSON.stringify((got.json() as { item: ImageMap }).item)).not.toContain('<script');
  });

  it('keeps every bundled template intact through a store round-trip', async () => {
    // The SVG-heavy templates are the risk: education alone builds 396 elements from tagName +
    // properties, and an over-eager allowlist would quietly gut the artwork.
    const { t, projectId } = await setup('imap-s6@x.test');
    for (const template of IMAGE_MAP_TEMPLATES) {
      const created = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/imagemaps/from-template`,
        cookies: { sw_session: t },
        payload: { template: template.id, id: `t-${template.id}` },
      });
      expect(created.statusCode, template.id).toBe(201);
      const item = (created.json() as { item: ImageMap }).item;
      let tags = 0;
      let props = 0;
      const walk = (objs: unknown): void => {
        if (!Array.isArray(objs)) return;
        for (const o of objs as Array<{ svg?: { tagName?: string; properties?: unknown[] }; children?: unknown }>) {
          if (o.svg?.tagName) tags++;
          if (Array.isArray(o.svg?.properties)) props += o.svg.properties.length;
          walk(o.children);
        }
      };
      item.artboards.forEach((a) => walk(a.children));
      if (template.id === 'education') {
        expect(tags, 'education svg elements').toBe(396);
        expect(props, 'education svg attributes').toBe(791);
      }
      if (template.id === 'us-national-parks') expect(tags).toBe(51);
    }
  });
});
