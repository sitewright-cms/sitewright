import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the Local Hosting serve options — which are now options on the `local` DEPLOY TARGET
// (preview-token gate, HTML minify) — and the gate that a project is served at /sites/<slug>/ ONLY
// when a local target exists. Assembly happens at deploy time (POST /publish builds the artifact).

const home = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section' },
  // Tailwind utility classes so the builder emits the shared styles.css asset (used to prove that
  // static assets stay ungated under a preview token).
  source: '<section class="p-6"><h1 class="text-2xl font-bold">Hello world</h1></section>',
};

describe('Local Hosting serve options (local deploy target: previewToken / minifyHtml)', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'optsite';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-opt-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-opt-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    // No auto Local Hosting target — each test configures the `local` target it needs.
    projectId = await client.createProject('Opt Site', slug, { localHosting: false });
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function seedSite() {
    const proj = client.project(projectId);
    const settings = {
      brand: { name: 'Opt Site', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect((await proj.putContent('settings', 'settings', settings)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
  }
  async function createLocalTarget(opts: { previewToken?: string; minifyHtml?: boolean } = {}): Promise<string> {
    const r = await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local', ...opts });
    expect(r.statusCode).toBe(201);
    return (r.json() as { target: { id: string } }).target.id;
  }
  async function deleteTarget(id: string) {
    expect((await client.del(`/projects/${projectId}/deploy-targets/${id}`)).statusCode).toBe(204);
  }
  async function publish() {
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
  }

  it('preview token (local target): a valid ?token= sets a path-scoped cookie + redirects clean; nav then carries the cookie', async () => {
    await seedSite();
    await createLocalTarget({ previewToken: 'tok_abcdefgh12345678' });
    await publish();

    // No token + no cookie → 403 (informative, utf-8).
    const noToken = await client.get(`/sites/${slug}/index.html`);
    expect(noToken.statusCode).toBe(403);
    expect(noToken.headers['content-type']).toContain('charset=utf-8');
    expect(noToken.body).toContain('a preview token is required');
    // Wrong token → 403.
    expect((await client.get(`/sites/${slug}/index.html?token=nope`)).statusCode).toBe(403);

    // Valid ?token= (the entry link) → 302 to the token-free URL + a path-scoped, Lax site cookie.
    const entry = await client.get(`/sites/${slug}/index.html?token=tok_abcdefgh12345678`);
    expect(entry.statusCode).toBe(302);
    expect(entry.headers.location).toBe(`/sites/${slug}/index.html`); // token stripped from the URL
    const cookie = entry.cookies.find((c) => c.name === `sw_site_${slug}`);
    expect(cookie?.value).toBe('tok_abcdefgh12345678');
    expect(cookie?.path).toBe(`/sites/${slug}/`);
    expect(cookie?.httpOnly).toBe(true);
    expect(String(cookie?.sameSite).toLowerCase()).toBe('lax');

    // With the cookie (what in-site navigation sends), the CLEAN URL serves — no token in the path.
    const withCookie = await client.inject({
      method: 'GET',
      url: `/sites/${slug}/index.html`,
      cookies: { [`sw_site_${slug}`]: 'tok_abcdefgh12345678' },
    });
    expect(withCookie.statusCode).toBe(200);
    expect(withCookie.body).toContain('Hello world');
    // A wrong cookie value is rejected (constant-time compare).
    const badCookie = await client.inject({
      method: 'GET',
      url: `/sites/${slug}/index.html`,
      cookies: { [`sw_site_${slug}`]: 'wrong' },
    });
    expect(badCookie.statusCode).toBe(403);

    // A static asset (sub-resource) stays ungated.
    expect((await client.get(`/sites/${slug}/styles.css`)).statusCode).toBe(200);
  });

  it('no Local Hosting target → not served locally (404); adding one serves it without a republish', async () => {
    await seedSite();
    await publish(); // builds the artifact, but with no local target it is not served locally
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(404);
    // Add a local target → served (the gate is live, read from the deploy targets).
    await createLocalTarget();
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(200);
  });

  it('minifyHtml (the local target option) collapses the published HTML (smaller; head whitespace gone)', async () => {
    await seedSite();
    const plainTarget = await createLocalTarget(); // no minify
    await publish();
    const plain = await client.get(`/sites/${slug}/index.html`);
    expect(plain.statusCode).toBe(200);
    expect(plain.body).toContain('</title>\n'); // pretty-printed head (a newline after the title)

    // Switch Local Hosting to minify (the target carries the option), then republish.
    await deleteTarget(plainTarget);
    await createLocalTarget({ minifyHtml: true });
    await publish();
    const min = await client.get(`/sites/${slug}/index.html`);
    expect(min.statusCode).toBe(200);
    expect(min.body).not.toContain('</title>\n'); // head whitespace collapsed
    expect(min.body.length).toBeLessThan(plain.body.length);
    expect(min.body).toContain('Hello world'); // content intact
  });
});
