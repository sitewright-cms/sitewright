import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * PREVIEW PAGES ARE NEVER INDEXED. Every preview surface is a draft, so every response it sends carries
 * `X-Robots-Tag: noindex`, whoever holds the link: the member-only draft site, a share link a client
 * posted somewhere public, the editor's preview documents, and the "link expired" pages too. Nothing to
 * switch on; the published site keeps its own indexing rules (`sites-domain-noindex.test.ts`).
 */

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
const noindex = (res: { headers: Record<string, unknown> }) => res.headers['x-robots-tag'];

describe('preview pages carry noindex', () => {
  let root: string;
  let h: Harness;
  let owner: TestClient;
  let projectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-preview-noindex-'));
    h = await makeHarness({
      previewRoot: join(root, 'preview'),
      publishRoot: join(root, 'sites'),
      mediaRoot: join(root, 'media'),
      cookieSecret: 'preview-noindex-secret',
      renderPool: new RenderPool({ size: 1, workerPath }),
    });
    owner = await h.signup({ admin: true });
    projectId = await owner.createProject('Site', 'site');
    const p = owner.project(projectId);
    expect((await p.putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: '<h1>Draft Home</h1>' })).statusCode).toBe(200);
    expect(
      (await p.putContent('page', 'about', { id: 'about', path: 'about', title: 'About', source: '<h1>Draft About</h1>' })).statusCode,
    ).toBe(200);
    expect(
      (await p.putContent('page', 'wip', { id: 'wip', path: 'wip', title: 'Secret Launch', status: 'draft', source: '<h1>WIP</h1>' })).statusCode,
    ).toBe(200);
  });
  afterEach(async () => {
    await h.close(); // also drains the render pool
    await rm(root, { recursive: true, force: true });
  });

  /** A request with NO session: a crawler, or the client a share link was sent to. */
  const visit = (url: string) => h.app.inject({ method: 'GET', url });
  async function defaultBase(): Promise<string> {
    const res = await owner.get(`/projects/${projectId}/preview-url`);
    expect(res.statusCode).toBe(200);
    return (res.json() as { base: string }).base;
  }
  async function shareUrl(): Promise<{ id: string; url: string }> {
    const res = await owner.post(`/projects/${projectId}/preview-shares`, { label: 'Client review' });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { id: string; url: string };
  }

  it('★ the member-only draft site: its pages, assets, redirects and misses', async () => {
    const base = await defaultBase();
    const page = await visit(base);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Draft Home'); // presence guard: the draft page itself
    expect(noindex(page)).toBe('noindex');

    const css = await visit(`${base}_assets/_sw/styles.css`);
    expect(css.statusCode).toBe(200);
    expect(noindex(css)).toBe('noindex');

    const hop = await visit(`${base}about`);
    expect(hop.statusCode).toBe(301);
    expect(noindex(hop)).toBe('noindex');
    const landed = await visit(String(hop.headers.location));
    expect(landed.body).toContain('Draft About');
    expect(noindex(landed)).toBe('noindex');

    const draftNotice = await visit(`${base}wip/`);
    expect(draftNotice.statusCode).toBe(404);
    expect(draftNotice.body).toContain('Secret Launch'); // the draft-page notice, not the blank 404
    expect(noindex(draftNotice)).toBe('noindex');

    const missing = await visit(`${base}nowhere/`);
    expect(missing.statusCode).toBe(404);
    expect(noindex(missing)).toBe('noindex');
  });

  it('★ a share link, an old share address, and the "expired or invalid" page', async () => {
    const share = await shareUrl();
    const page = await visit(share.url);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Draft Home');
    expect(noindex(page)).toBe('noindex');
    // A crawler's HEAD hits Fastify's auto-generated HEAD route, which copies the GET route's config.
    const head = await h.app.inject({ method: 'HEAD', url: share.url });
    expect(head.statusCode).toBe(200);
    expect(noindex(head)).toBe('noindex');

    const legacy = share.url.replace('/preview-site/site/', `/preview-site/${projectId}/`);
    expect(legacy).not.toBe(share.url);
    const hop = await visit(legacy);
    expect(hop.statusCode).toBe(301);
    expect(noindex(hop)).toBe('noindex');

    expect((await owner.del(`/projects/${projectId}/preview-shares/${share.id}`)).statusCode).toBeLessThan(300);
    const revoked = await visit(share.url);
    expect(revoked.statusCode).toBe(404);
    expect(revoked.body).toContain('Preview link expired or invalid');
    expect(noindex(revoked)).toBe('noindex');

    const forged = await visit('/preview-site/site/not-a-real-signature/');
    expect(forged.statusCode).toBe(404);
    expect(noindex(forged)).toBe('noindex');
  });

  it("the editor's preview document, and its expired miss", async () => {
    const res = await owner.post(`/projects/${projectId}/render-template`, { template: '<h1>{{ company.name }}</h1>', document: true });
    expect(res.statusCode, res.body).toBe(200);
    const { token } = res.json() as { token: string };
    const doc = await owner.get(`/preview/site/${token}`);
    expect(doc.statusCode).toBe(200);
    expect(doc.body).toContain('<h1>Site</h1>');
    expect(noindex(doc)).toBe('noindex');

    const expired = await visit(`/preview/site/${token}`); // no session → the opaque 404
    expect(expired.statusCode).toBe(404);
    expect(noindex(expired)).toBe('noindex');
  });

  it('the snippet hover preview and the image-map preview', async () => {
    expect((await owner.project(projectId).putContent('snippet', 'card', { id: 'card', name: 'card', source: '<p>Card body</p>' })).statusCode).toBe(200);
    const snippet = await owner.get(`/projects/${projectId}/snippets/card/preview`);
    expect(snippet.statusCode).toBe(200);
    expect(snippet.body).toContain('Card body');
    expect(noindex(snippet)).toBe('noindex');

    const map = await owner.get(`/projects/${projectId}/imagemaps/preview?template=engineering`);
    expect(map.statusCode).toBe(200);
    expect(String(map.headers['content-type'])).toContain('text/html');
    expect(noindex(map)).toBe('noindex');
  });

  it('the authoring previews, which need no session at all', async () => {
    for (const url of ['/authoring/parallax-preview?translate=0,40', '/authoring/svg-preview?effect=draw', '/authoring/svg-studio-preview']) {
      const res = await visit(url);
      expect(res.statusCode, url).toBe(200);
      expect(String(res.headers['content-type']), url).toContain('text/html');
      expect(noindex(res), url).toBe('noindex');
    }
  });

  it('★ only previews: the published site, the editor API and the app itself stay as they were', async () => {
    expect((await owner.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    const site = await visit('/sites/site/');
    expect(site.statusCode).toBe(200);
    expect(site.body).toContain('Draft Home'); // presence guard: the published page
    expect(noindex(site)).toBeUndefined();

    const api = await owner.get(`/projects/${projectId}/preview-url`);
    expect(api.statusCode).toBe(200);
    expect(noindex(api)).toBeUndefined();

    const health = await visit('/health');
    expect(health.statusCode).toBe(200);
    expect(noindex(health)).toBeUndefined();
  });
});

/**
 * The next preview route must not be forgotten. Every GET route with "preview" in its path either is
 * flagged `noindexed` or is named below as not being a page at all.
 */
const NOT_A_PAGE = new Set([
  '/authoring/button-preview-css', // a stylesheet for the editor's button picker
  '/f/:projectId/:formId/preview/challenge', // JSON: a proof-of-work challenge for the dry run
  '/pay/:projectId/:channelKey/preview/challenge', // JSON, likewise for the cart's dry run
  '/projects/:projectId/preview-locate', // JSON for the editor
  '/projects/:projectId/preview-progress', // JSON for the editor
  '/projects/:projectId/preview-shares', // JSON: the share list
  '/projects/:projectId/preview-url', // JSON: the signed preview base
]);

describe('every preview page route is noindexed', () => {
  it('flags each GET preview route, or names it as not a page', async () => {
    const seen: Array<{ url: string; noindex: boolean }> = [];
    const dir = await mkdtemp(join(tmpdir(), 'sw-preview-routes-'));
    const app = await createApp({
      db: await makeTestDb(),
      // Production-shaped (see contract-http.test.ts), so every optional preview route registers.
      mediaRoot: join(dir, 'media'),
      publishRoot: join(dir, 'sites'),
      previewRoot: join(dir, 'preview'),
      dataDir: dir,
      encryptionKey: randomBytes(32),
      onRoute: (route: { method: string | string[]; url: string; config?: { noindex?: boolean } }) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        if (methods.includes('GET') && route.url.includes('preview')) {
          seen.push({ url: route.url, noindex: route.config?.noindex === true });
        }
      },
    });
    try {
      await app.ready();
      expect(seen.map((r) => r.url)).toContain('/preview-site/:projectId/:sig/*'); // presence guard
      const unflagged = seen.filter((r) => !r.noindex && !NOT_A_PAGE.has(r.url)).map((r) => r.url);
      expect(unflagged, 'a preview page route without noindexed(...)').toEqual([]);
      // And nothing named as "not a page" quietly became one.
      const flaggedButListed = seen.filter((r) => r.noindex && NOT_A_PAGE.has(r.url)).map((r) => r.url);
      expect(flaggedButListed).toEqual([]);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
