import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: a Tabs component publishes its panels (PE: all visible, stacked)
// + a served components.js that builds the tablist; the preview inlines behavior.

describe('Tabs component → publish + preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  const page = {
    id: 'home',
    path: '/',
    title: 'Docs',
    root: {
      id: 'r',
      type: 'Tabs',
      children: [
        { id: 't1', type: 'Tab', props: { title: 'Overview' }, children: [{ id: 'a', type: 'RichText', props: { text: 'Intro' } }] },
        { id: 't2', type: 'Tab', props: { title: 'Pricing' }, children: [{ id: 'b', type: 'RichText', props: { text: 'Plans' } }] },
      ],
    },
  };

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-tabs-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-tabs-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('publishes titled panels + a served tablist-building bundle', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.body).toContain('data-sw-component="tabs"');
    expect(index.body).toContain('data-sw-title="Overview"');
    expect(index.body).toContain('Intro'); // panel content present (PE: visible without JS)
    expect(index.body).toContain('Plans');
    expect(index.body).toContain('<script defer src="components.js"></script>');

    const bundle = await client.get(`/sites/${slug}/components.js`);
    expect(bundle.statusCode).toBe(200);
    expect(bundle.body).toContain('data-sw-component="tabs"'); // tabs enhancer present

    // Preview inlines the behavior (doc runs scripts under CSP: sandbox).
    const prev = await client.post(`/projects/${projectId}/preview`, page);
    expect((prev.json() as { html: string }).html).toContain("role','tab'");
  });
});
