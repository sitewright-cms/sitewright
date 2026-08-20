import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { makePng } from './png.js';

/**
 * INTEGRATION: getting structured data to a script, end to end through a real publish.
 *
 * The unit tests prove the escaping and the refusals. What only a publish can prove is the part that
 * has burned this platform before: that the artifact is actually SERVED. The site-search index was
 * emitted correctly for months and 404'd on every platform-hosted site because `.json` was left out of
 * the asset route — green build, empty feature, and only a browser against a deployed instance found
 * it. So this test fetches both artifacts back over HTTP.
 */
describe('json data → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'jsondata';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-json-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-json-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('JsonData', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('emits an on-page island and a fetchable .json data file', async () => {
    const proj = client.project(projectId);

    const settingsRes = await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      website: {
        dataFiles: [{ path: 'products.json', dataset: 'products', fields: ['name', 'price'] }],
      },
      settings: {},
    });
    expect(settingsRes.statusCode, settingsRes.body).toBe(200);

    // A dataset with a published row and a DRAFT row — only the published one may be emitted.
    const dsRes = await proj.putContent('dataset', 'products', {
      id: 'products',
      name: 'Products',
      slug: 'products',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'price', type: 'number', required: false },
        { name: 'internalNote', type: 'text', required: false },
      ],
    });
    expect(dsRes.statusCode, dsRes.body).toBe(200);
    for (const [id, status, values] of [
      ['p1', 'published', { name: 'Cap', price: 120, internalNote: 'do not ship' }],
      ['p2', 'draft', { name: 'Secret prototype', price: 999 }],
    ] as const) {
      const entryRes = await proj.putContent('entry', id, { id, dataset: 'products', status, values });
      expect(entryRes.statusCode, entryRes.body).toBe(200);
    }

    const home = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section' },
      // The island carries a projection, never the namespace.
      source: '<section>{{sw-json-data dataset.products id="products"}}</section>',
    };
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    // ── the on-page island ──
    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('<script type="application/json" id="products">');
    const island = index.body.slice(
      index.body.indexOf('id="products">') + 'id="products">'.length,
      index.body.indexOf('</script>', index.body.indexOf('id="products">')),
    );
    const rows = JSON.parse(island) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.name)).toEqual(['Cap']); // the draft never reaches the page
    expect(island).not.toContain('Secret prototype');
    // ★ FLAT rows — the same shape {{#each dataset.products}}{{name}}{{/each}} renders from. The raw
    // storage record ({id, dataset, status, order, values}) must not reach the page: it is a different
    // shape from the one the author sees, and it publishes internal machinery.
    expect(rows[0]).not.toHaveProperty('values');
    expect(rows[0]).not.toHaveProperty('status');
    expect(rows[0]).not.toHaveProperty('order');

    // ── the emitted data file, over HTTP, with the right content type ──
    const file = await client.get(`/sites/${slug}/data/products.json`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('application/json');
    const fileRows = JSON.parse(file.body) as Array<Record<string, unknown>>;
    // `fields` narrowed the columns, and the draft row is absent here too.
    expect(fileRows).toEqual([{ name: 'Cap', price: 120 }]);
    expect(file.body).not.toContain('do not ship');
    expect(file.body).not.toContain('Secret prototype');

    // ★ The build manifest stays unreachable. `.json` is not a servable ROOT extension precisely so
    // release.json (route counts, page failures, build warnings) cannot be fetched — data files are
    // servable because they live under `data/`, not because the root was opened up.
    expect((await client.get(`/sites/${slug}/release.json`)).statusCode).toBe(404);
    expect((await client.get(`/sites/${slug}/data/../release.json`)).statusCode).not.toBe(200);
  });

  it('a folder file with full= names TWO variants, and the export contains BOTH', async () => {
    // ★ The failure this guards is not "the JSON is wrong" — it is a data file naming a file the
    // export never produced. A published site bundles only REFERENCED variants, so an unregistered
    // `full` yields a gallery whose tiles render and whose lightbox 404s, and nothing upstream says
    // so. Both URLs are therefore fetched back over HTTP.
    const proj = client.project(projectId);
    const boundary = 'SWJSONDATA';
    const png = makePng(1600, 1200, [30, 90, 160]);
    const upload = await client.inject({
      method: 'POST',
      url: `${proj.base}/media?folder=gallery`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tile.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(upload.statusCode, upload.body).toBe(201);

    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: { dataFiles: [{ path: 'gallery.json', folder: 'gallery', size: 'sm', full: 'lg' }] },
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section>Gallery</section>' })).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const file = await client.get(`/sites/${slug}/data/gallery.json`);
    expect(file.statusCode).toBe(200);
    const rows = JSON.parse(file.body) as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    // Two DIFFERENT published URLs — the tile and what a lightbox opens.
    expect(rows[0]!.url).toMatch(/^_assets\/.+\.webp$/);
    expect(rows[0]!.full).toMatch(/^_assets\/.+\.webp$/);
    expect(rows[0]!.full).not.toBe(rows[0]!.url);

    // ★ Both are really in the export. This is the assertion that would have failed before `full`
    // registered its variant for materialization.
    for (const url of [rows[0]!.url, rows[0]!.full]) {
      const asset = await client.get(`/sites/${slug}/${url}`);
      expect(asset.statusCode, `${url} is named by the data file but absent from the export`).toBe(200);
    }
    // …and the FULL one is the larger file, so the two names are not the same image twice.
    const small = await client.get(`/sites/${slug}/${rows[0]!.url}`);
    const large = await client.get(`/sites/${slug}/${rows[0]!.full}`);
    expect(large.rawPayload.length).toBeGreaterThan(small.rawPayload.length);
  });

  it('does not emit a data file for a site that declares none', async () => {
    const proj = client.project(projectId);
    expect(
      (
        await proj.putContent('settings', 'settings', {
          identity: { name: 'Acme', colors: { primary: '#0a7' } },
          website: {},
          settings: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await proj.putContent('page', 'home', {
          id: 'home',
          path: '',
          title: 'Home',
          root: { id: 'r', type: 'Section' },
          source: '<section><h1>Plain</h1></section>',
        })
      ).statusCode,
    ).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);
    expect((await client.get(`/sites/${slug}/data/products.json`)).statusCode).toBe(404);
  });
});
