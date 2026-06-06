import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: Modal (native <dialog>) and CookieConsent (localStorage banner)
// flow through publish — behavior bundled in components.js, CSS inlined — and
// render live in the preview (inlined behavior).

describe('Modal + CookieConsent → publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-mc-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-mc-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('publishes a Modal (dialog + served behavior) and previews it live', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: {
        id: 'r',
        type: 'Modal',
        props: { trigger: 'Contact', label: 'Contact us' },
        children: [{ id: 'c', type: 'RichText', props: { text: 'Reach us at hi@x.test' } }],
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-component="modal"');
    expect(index.body).toContain('<dialog data-sw-part="dialog"');
    expect(index.body).toContain('::backdrop'); // modal CSS inlined
    expect(index.body).toContain('<script defer src="components.js"></script>');

    const bundle = await client.get(`/sites/${slug}/components.js`);
    expect(bundle.statusCode).toBe(200);
    expect(bundle.body).toContain('showModal'); // native dialog behavior

    // Preview: behavior is inlined (the doc runs scripts under CSP: sandbox).
    const prev = await client.post(`/projects/${projectId}/preview`, page);
    expect((prev.json() as { html: string }).html).toContain('showModal');
  });

  it('publishes a CookieConsent banner (hidden, localStorage-gated)', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: {
        id: 'r',
        type: 'CookieConsent',
        props: { message: 'We use cookies.', acceptText: 'Got it', policyHref: '/privacy' },
      },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-component="cookie-consent"');
    expect(index.body).toMatch(/<div data-sw-block="CookieConsent"[^>]*hidden>/); // hidden until consented
    expect(index.body).toContain('We use cookies.');
    expect(index.body).toContain('href="privacy"'); // policy link

    const bundle = await client.get(`/sites/${slug}/components.js`);
    expect(bundle.body).toContain('localStorage'); // remembers dismissal
  });
});
