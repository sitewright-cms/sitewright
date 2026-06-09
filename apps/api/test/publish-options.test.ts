import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the "PUBLISH" tab options on website settings — local hosting toggle, preview-token
// gate, and HTML minification — flow through publish + the /sites/<slug>/ static route.

const home = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section' },
  // Tailwind utility classes so the builder emits the shared styles.css asset (used to prove that
  // static assets stay ungated under a preview token).
  source: '<section class="p-6"><h1 class="text-2xl font-bold">Hello world</h1></section>',
};

describe('publish options (localPublish / previewToken / minifyHtml)', () => {
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
    projectId = await client.createProject('Opt Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function setWebsite(website: Record<string, unknown> | undefined) {
    const proj = client.project(projectId);
    const payload = {
      brand: { name: 'Opt Site', colors: { primary: '#e11' } },
      ...(website ? { website } : {}),
      settings: { defaultLocale: 'en', locales: ['en'] },
    };
    expect((await proj.putContent('settings', 'settings', payload)).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', home)).statusCode).toBe(200);
  }
  async function publish() {
    expect((await client.post(`${client.project(projectId).base}/publish`)).statusCode).toBe(200);
  }

  it('preview token: HTML pages require a matching ?token=, but static assets stay ungated', async () => {
    await setWebsite({ previewToken: 'tok_abcdefgh12345678' });
    await publish();

    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(403); // no token
    expect((await client.get(`/sites/${slug}/index.html?token=nope`)).statusCode).toBe(403); // wrong token
    const ok = await client.get(`/sites/${slug}/index.html?token=tok_abcdefgh12345678`);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('Hello world');
    // A static asset (the compiled utility sheet) is a sub-resource, not the protected page → ungated.
    expect((await client.get(`/sites/${slug}/styles.css`)).statusCode).toBe(200);
  });

  it('localPublish=false stops serving the page locally (the artifact still builds for deploy)', async () => {
    await setWebsite({ localPublish: false });
    await publish();
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(404);
    // Re-enabling restores serving without a republish (the gate is live, read from settings).
    await setWebsite({ localPublish: true });
    expect((await client.get(`/sites/${slug}/index.html`)).statusCode).toBe(200);
  });

  it('minifyHtml collapses the published HTML (smaller; inter-element head whitespace gone)', async () => {
    await setWebsite(undefined);
    await publish();
    const plain = await client.get(`/sites/${slug}/index.html`);
    expect(plain.statusCode).toBe(200);
    expect(plain.body).toContain('</title>\n'); // pretty-printed head (a newline after the title)

    await setWebsite({ minifyHtml: true });
    await publish();
    const min = await client.get(`/sites/${slug}/index.html`);
    expect(min.statusCode).toBe(200);
    expect(min.body).not.toContain('</title>\n'); // head whitespace collapsed
    expect(min.body.length).toBeLessThan(plain.body.length);
    expect(min.body).toContain('Hello world'); // content intact
  });
});
