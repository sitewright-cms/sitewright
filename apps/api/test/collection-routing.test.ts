import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { entrySlug } from '@sitewright/core';
import type { Entry } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// Integration coverage for dataset-driven COLLECTION PAGE expansion through publish.
// Extends the dataset/publish suites: a collection page `/products/[slug]` with
// `collection:{dataset,param}` must expand to exactly one rendered HTML page per
// PUBLISHED entry (drafts excluded), at the slug `entrySlug` derives, with each
// page rendering its own bound entry data and portable (page-relative) links.
//
// Uses the default IN-PROCESS build runner (no SW_BUILD_WORKER / Docker), the
// shared harness, and the public `/sites/<projectId>/...` serve route to read
// exported HTML — mirroring publish-api.test.ts.

let harness: Harness;
let publishRoot: string;
let client: TestClient;
let project: ProjectClient;
let base: string;
const slug = 'collection-site';

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-collection-'));
  harness = await makeHarness({ publishRoot });
  client = await harness.signup();
  const projectId = await client.createProject('Site', slug);
  project = client.project(projectId);
  base = project.base;
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

// A dataset keyed by slug (id === slug, as the editor does it), with a `slug`
// field that the collection page uses as its `[param]`.
const productsDataset = {
  id: 'products',
  name: 'Products',
  slug: 'products',
  fields: [
    { name: 'slug', type: 'text', required: true },
    { name: 'title', type: 'text', required: true },
  ],
};

// A collection page: one route per PUBLISHED `products` entry, rendered at
// `/products/<entrySlug>`. The Heading binds to the entry's `title` field
// (props.textField -> entry.values.title), and the Link is an internal
// root-relative link that must be rebased page-relative ("../") in the export.
// A `products` landing page; the collection detail page nests under it (slug `[slug]`),
// so each entry renders at the computed route /products/<entrySlug>.
const productsPage = {
  id: 'products',
  path: 'products',
  title: 'Products',
  root: { id: 'pr', type: 'Section' },
};
const collectionPage = {
  id: 'product-detail',
  path: '[slug]',
  parent: 'products',
  title: 'Product',
  collection: { dataset: 'products', param: 'slug' },
  root: {
    id: 'r',
    type: 'Section',
    children: [
      { id: 'h', type: 'Heading', props: { level: 1, textField: 'title' } },
      { id: 'back', type: 'Link', props: { text: 'Home', href: '/' } },
    ],
  },
};

const homePage = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'hr', type: 'Section', children: [{ id: 'hh', type: 'Heading', props: { text: 'Welcome' } }] },
};

function entry(id: string, slug: string, title: string, status: 'draft' | 'published'): Entry {
  return { id, dataset: 'products', status, values: { slug, title } } as Entry;
}

/** Publishes and returns the parsed `{ release, url }` body (fails the test on non-200). */
async function publish(): Promise<{ release: { routes: number; bytes: number }; url: string }> {
  const res = await client.post(`${base}/publish`);
  expect(res.statusCode).toBe(200);
  return res.json() as { release: { routes: number; bytes: number }; url: string };
}

/** Fetches an exported HTML file from the public serve route (keyed by slug). */
function served(siteSlug: string, path: string) {
  return harness.app.inject({ method: 'GET', url: `/sites/${siteSlug}/${path}` });
}

describe('collection page routing through publish', () => {
  it('expands one HTML page per PUBLISHED entry (drafts excluded), at entrySlug-derived slugs', async () => {
    await project.putContent('dataset', 'products', productsDataset);
    const published1 = entry('p-alpha', 'alpha', 'Alpha Widget', 'published');
    const published2 = entry('p-beta', 'beta', 'Beta Widget', 'published');
    const draft = entry('p-gamma', 'gamma', 'Gamma Draft', 'draft');
    await project.putContent('entry', published1.id, published1);
    await project.putContent('entry', published2.id, published2);
    await project.putContent('entry', draft.id, draft);
    await project.putContent('page', 'products', productsPage);
    await project.putContent('page', collectionPage.id, collectionPage);

    const { release } = await publish();
    // One route per published entry, plus the auto-created HOME page every project starts with.
    expect(release.routes).toBe(4);

    // Slugs derive via entrySlug: safe `slug` value wins -> /products/alpha, /products/beta.
    expect(entrySlug(published1, 'slug')).toBe('alpha');
    expect(entrySlug(published2, 'slug')).toBe('beta');

    const alpha = await served(slug, 'products/alpha/');
    const beta = await served(slug, 'products/beta/');
    expect(alpha.statusCode).toBe(200);
    expect(beta.statusCode).toBe(200);
    expect(alpha.headers['content-type']).toContain('text/html');

    // The DRAFT entry produces NO page (drafts are excluded from a published build).
    const gamma = await served(slug, `products/${entrySlug(draft, 'slug')}/`);
    expect(gamma.statusCode).toBe(404);
  });

  it('renders each entry’s bound data and keeps internal links page-relative', async () => {
    await project.putContent('dataset', 'products', productsDataset);
    const alpha = entry('p-alpha', 'alpha', 'Alpha Widget', 'published');
    const beta = entry('p-beta', 'beta', 'Beta Widget', 'published');
    await project.putContent('entry', alpha.id, alpha);
    await project.putContent('entry', beta.id, beta);
    await project.putContent('page', 'products', productsPage);
    await project.putContent('page', collectionPage.id, collectionPage);
    await publish();

    const alphaHtml = (await served(slug, 'products/alpha/')).body;
    const betaHtml = (await served(slug, 'products/beta/')).body;

    // Each generated page renders ITS OWN entry's bound `title` field.
    expect(alphaHtml).toContain('Alpha Widget');
    expect(alphaHtml).not.toContain('Beta Widget');
    expect(betaHtml).toContain('Beta Widget');
    expect(betaHtml).not.toContain('Alpha Widget');

    // Portability at collection depth: the root-relative "/" Link is rebased to a
    // page-relative path. The slug is `products/alpha` (two segments), so the output
    // file lives at `products/alpha/index.html` and relativeRoot returns "../../"
    // (one `../` per slug segment). The artifact therefore works at any base path.
    expect(alphaHtml).toContain('href="../../"');
    expect(alphaHtml).not.toContain('href="/"');
  });

  it('reflects static pages + expanded collection routes in the publish manifest', async () => {
    await project.putContent('dataset', 'products', productsDataset);
    const alpha = entry('p-alpha', 'alpha', 'Alpha Widget', 'published');
    const beta = entry('p-beta', 'beta', 'Beta Widget', 'published');
    await project.putContent('entry', alpha.id, alpha);
    await project.putContent('entry', beta.id, beta);
    await project.putContent('page', homePage.id, homePage);
    await project.putContent('page', 'products', productsPage);
    await project.putContent('page', collectionPage.id, collectionPage);

    const { release } = await publish();
    // 1 static (home) + 2 expanded collection routes = 3.
    expect(release.routes).toBe(4);

    // GET /publish reports the same release.routes count.
    const status = await client.get(`${base}/publish`);
    expect((status.json() as { release: { routes: number } }).release.routes).toBe(4);

    // The static home and both expanded routes are all servable.
    expect((await served(slug, '')).statusCode).toBe(200);
    expect((await served(slug, 'products/alpha/')).statusCode).toBe(200);
    expect((await served(slug, 'products/beta/')).statusCode).toBe(200);
  });

  it('rejects a collection page whose collection/[param] definition is inconsistent (400)', async () => {
    await project.putContent('dataset', 'products', productsDataset);

    // (a) collection set but path has NO [param] segment -> PageSchema.superRefine -> ZodError -> 400.
    const collectionWithoutParam = {
      ...collectionPage,
      id: 'no-param',
      path: 'products',
    };
    const resA = await project.putContent('page', collectionWithoutParam.id, collectionWithoutParam);
    expect(resA.statusCode).toBe(400);

    // (b) path HAS a [param] segment but no collection definition -> 400.
    const paramWithoutCollection = {
      id: 'no-collection',
      path: '[slug]',
      title: 'Orphan',
      root: { id: 'r2', type: 'Section', children: [] },
    };
    const resB = await project.putContent('page', paramWithoutCollection.id, paramWithoutCollection);
    expect(resB.statusCode).toBe(400);

    // NOTE on the other "inconsistency" — a collection page referencing a dataset
    // that does not exist. That is a CROSS-ENTITY check (`unknown_collection_dataset`
    // in validateProject) which the API only runs on /import (-> 409), NOT on
    // /publish. At publish such a page simply yields zero routes (no error). See the
    // dedicated case below documenting that exact behavior.
  });

  it('does NOT error at publish for a collection page pointing at an unknown dataset — it yields zero routes (documents real behavior)', async () => {
    // No dataset named `ghosts` exists. publish() runs buildSite -> allRoutes, which
    // does not run validateProject; collectionRoutes filters entries by dataset and
    // finds none, so the page contributes zero routes (no 409, no crash).
    const ghostCollection = {
      id: 'ghost-detail',
      path: '[slug]',
      title: 'Ghost',
      collection: { dataset: 'ghosts', param: 'slug' },
      root: { id: 'gr', type: 'Section', children: [{ id: 'gh', type: 'Heading', props: { textField: 'title' } }] },
    };
    await project.putContent('page', homePage.id, homePage);
    await project.putContent('page', ghostCollection.id, ghostCollection);

    const { release } = await publish();
    // Only the static home page renders; the unknown-dataset collection expands to nothing.
    expect(release.routes).toBe(1);
    expect((await served(slug, '')).statusCode).toBe(200);
  });

  it('handles entries that would collide on slug deterministically (entrySlug falls back to entry id)', async () => {
    await project.putContent('dataset', 'products', productsDataset);

    // Both entries carry the SAME `slug` field value, but it is NOT a safe URL
    // segment (it has spaces / uppercase). entrySlug rejects unsafe values and
    // falls back to the entry id — which the schema constrains to be unique and
    // safe — so the two routes get DISTINCT, deterministic slugs (the entry ids).
    const a = entry('collide-a', 'Same Title', 'First', 'published');
    const b = entry('collide-b', 'Same Title', 'Second', 'published');
    expect(entrySlug(a, 'slug')).toBe('collide-a'); // unsafe value -> id fallback
    expect(entrySlug(b, 'slug')).toBe('collide-b');
    expect(entrySlug(a, 'slug')).not.toBe(entrySlug(b, 'slug')); // deterministic, distinct

    await project.putContent('entry', a.id, a);
    await project.putContent('entry', b.id, b);
    await project.putContent('page', 'products', productsPage);
    await project.putContent('page', collectionPage.id, collectionPage);

    // No crash: both routes render at distinct, id-derived output paths (+ the auto-created home).
    const { release } = await publish();
    expect(release.routes).toBe(4);

    const pageA = await served(slug, 'products/collide-a/');
    const pageB = await served(slug, 'products/collide-b/');
    expect(pageA.statusCode).toBe(200);
    expect(pageB.statusCode).toBe(200);
    expect(pageA.body).toContain('First');
    expect(pageB.body).toContain('Second');
  });

  it('rejects (409) when two entries DO resolve to the same slug — allRoutes duplicate-route guard', async () => {
    await project.putContent('dataset', 'products', productsDataset);

    // Two entries whose `slug` values are BOTH safe segments AND identical: they
    // resolve to the same `/products/dup` route. allRoutes throws (duplicate route),
    // buildSite wraps it as PublishError, and /publish maps that to 409.
    const a = entry('dup-a', 'dup', 'First Dup', 'published');
    const b = entry('dup-b', 'dup', 'Second Dup', 'published');
    expect(entrySlug(a, 'slug')).toBe('dup');
    expect(entrySlug(b, 'slug')).toBe('dup'); // genuine collision

    await project.putContent('entry', a.id, a);
    await project.putContent('entry', b.id, b);
    await project.putContent('page', 'products', productsPage);
    await project.putContent('page', collectionPage.id, collectionPage);

    const res = await client.post(`${base}/publish`);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/duplicate route/i);
  });
});
