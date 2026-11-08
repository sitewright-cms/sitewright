import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RenderPool } from '../src/render/render-pool.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * THE PLATFORM IS NEVER INDEXED. Everything it answers outside `/sites/` carries `X-Robots-Tag: noindex`
 * and its robots.txt disallows it: the editor and its API, the draft site and its share links (a client
 * may post one somewhere public), the editor's preview documents, media, unknown paths. A hosted site is
 * the exception while the admin's `sitesDomainNoindex` switch is off; with it on, the site's platform
 * addresses answer noindex too (`sites-domain-noindex.test.ts`). `/sites/` stays open in robots.txt either
 * way, so a crawler can fetch those pages and SEE that noindex.
 */

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
const noindex = (res: { headers: Record<string, unknown> }) => res.headers['x-robots-tag'];

describe('the platform is never indexed', () => {
  let root: string;
  let h: Harness;
  let owner: TestClient;
  let projectId: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-platform-noindex-'));
    await mkdir(join(root, 'editor'));
    await writeFile(join(root, 'editor', 'index.html'), '<!doctype html><title>Sitewright</title><div id="root"></div>');
    h = await makeHarness({
      editorDist: join(root, 'editor'),
      previewRoot: join(root, 'preview'),
      publishRoot: join(root, 'sites'),
      mediaRoot: join(root, 'media'),
      cookieSecret: 'platform-noindex-secret',
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
    // A crawler often asks with HEAD first.
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

  it('★ the editor shell, its API, health checks and unknown paths', async () => {
    const shell = await visit('/');
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('<title>Sitewright</title>'); // presence guard: the SPA shell itself
    expect(noindex(shell)).toBe('noindex');

    const route = await visit('/login'); // a client-side route answered by the SPA fallback
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('<title>Sitewright</title>');
    expect(noindex(route)).toBe('noindex');

    const api = await owner.get('/projects');
    expect(api.statusCode).toBe(200);
    expect(noindex(api)).toBe('noindex');

    const health = await visit('/health');
    expect(health.statusCode).toBe(200);
    expect(noindex(health)).toBe('noindex');

    const media = await visit('/media/site/nothing-here.jpg');
    expect(media.statusCode).toBe(404);
    expect(noindex(media)).toBe('noindex');
  });

  it("★ the platform's robots.txt: only the /sites/ path form is crawlable, whatever the switch says", async () => {
    const off = await visit('/robots.txt');
    expect(off.statusCode).toBe(200);
    expect(String(off.headers['content-type'])).toContain('text/plain');
    expect(off.headers['cache-control']).toBe('no-cache');
    expect(off.body).toBe('User-agent: *\nAllow: /sites/\nDisallow: /\n');

    // ★ With hosted sites hidden, `/sites/` stays open: a crawler turned away never sees their noindex.
    expect((await owner.put('/admin/settings', { sitesDomainNoindex: true })).statusCode).toBe(200);
    const on = await visit('/robots.txt');
    expect(on.body).toBe('User-agent: *\nAllow: /sites/\nDisallow: /\n');
  });

  it('★ a hosted site is the exception: no header while the switch is off', async () => {
    expect((await owner.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    const site = await visit('/sites/site/');
    expect(site.statusCode).toBe(200);
    expect(site.body).toContain('Draft Home'); // presence guard: the published page
    expect(noindex(site)).toBeUndefined();
    const robots = await visit('/sites/site/robots.txt');
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('User-agent: *'); // the site's own file, from its publish
    expect(robots.body).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(noindex(robots)).toBeUndefined();

    // With the switch on, the path form answers noindex, and its robots.txt stays the site's own, open file.
    expect((await owner.put('/admin/settings', { sitesDomainNoindex: true })).statusCode).toBe(200);
    expect(noindex(await visit('/sites/site/'))).toBe('noindex');
    const hiddenRobots = await visit('/sites/site/robots.txt');
    expect(hiddenRobots.body).toContain('User-agent: *');
    expect(hiddenRobots.body).not.toMatch(/^Disallow:\s*\/\s*$/m);
  });
});
