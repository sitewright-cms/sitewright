import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration: the Html (raw embed) block carries the author's trusted HTML
// through preview + publish unescaped — the contentBase "code snippet" feature
// for maps/forms/video/widgets. Security backstops verified here: content writes
// are owner/admin-only (tested in tenancy suites) and the same-origin /sites/
// serving carries a strict CSP that blocks inline scripts.

describe('Html (raw embed) block', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  const EMBED = '<iframe src="https://www.google.com/maps?q=1" title="Map" loading="lazy"></iframe>';

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-html-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-html-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Site', 'site');
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const pageWithEmbed = {
    id: 'home',
    path: '/',
    title: 'Home',
    root: {
      id: 'r',
      type: 'Section',
      children: [{ id: 'e', type: 'Html', props: { html: EMBED } }],
    },
  };

  it('publishes the raw embed into the exported page, unescaped', async () => {
    const proj = client.project(projectId);
    expect((await proj.putContent('page', 'home', pageWithEmbed)).statusCode).toBe(200);
    expect((await client.post(`${proj.base}/publish`)).statusCode).toBe(200);

    const res = await client.get(`/sites/${projectId}/index.html`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div data-sw-block="Html"');
    expect(res.body).toContain(EMBED); // raw, not escaped
    expect(res.body).not.toContain('&lt;iframe');
  });

  it('renders the raw embed in the live preview', async () => {
    const res = await client.post(`/orgs/${client.orgId}/projects/${projectId}/preview`, pageWithEmbed);
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain(EMBED);
  });

  it('serves the same-origin published page under a script-blocking CSP', async () => {
    const proj = client.project(projectId);
    await proj.putContent('page', 'home', pageWithEmbed);
    await client.post(`${proj.base}/publish`);

    const res = await client.get(`/sites/${projectId}/index.html`);
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    // No `script-src` relaxation → inline embed scripts cannot execute on the
    // same-origin preview (they run only on the customer's own webspace export).
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
  });
});
