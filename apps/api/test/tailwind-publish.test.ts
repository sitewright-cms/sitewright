import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: when a site uses Tailwind utility classes, the publisher compiles
// ONE minimal shared stylesheet (only the used utilities), writes it at the site
// root, and links it from every page at the correct relative depth. Sites that
// use no utility classes are unchanged (no extra file, no extra request).

describe('Tailwind utility layer → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-tw-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-tw-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('emits no stylesheet (and no link) for a site that uses no utility classes', async () => {
    const proj = client.project(projectId);
    const page = {
      id: 'home',
      path: '',
      title: 'Home',
      root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Hi' } }] },
    };
    expect((await proj.putContent('page', 'home', page)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const index = await client.get(`/sites/${slug}/index.html`);
    expect(index.statusCode).toBe(200);
    expect(index.body).not.toContain('rel="stylesheet"');

    const sheet = await client.get(`/sites/${slug}/styles.css`);
    expect(sheet.statusCode).toBe(404); // never written
  });

});
