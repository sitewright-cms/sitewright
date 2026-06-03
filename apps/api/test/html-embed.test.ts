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

  it('returns preview as a JSON payload (never a same-origin text/html response)', async () => {
    // Preview is readable by any project member, but the raw HTML is only ever
    // returned as JSON for the client's OWN sandboxed iframe — never served as a
    // same-origin text/html document that could script the editor session.
    const res = await client.post(`/projects/${projectId}/preview`, pageWithEmbed);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('text/html');
    const html = (res.json() as { html: string }).html;
    expect(html).toContain(EMBED);
  });

  it('serves the same-origin published page under a script-blocking CSP', async () => {
    const proj = client.project(projectId);
    await proj.putContent('page', 'home', pageWithEmbed);
    await client.post(`${proj.base}/publish`);

    const res = await client.get(`/sites/${projectId}/index.html`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    // The operative invariant: no script-src is declared, so scripts fall back to
    // `default-src 'self'` — blocking BOTH inline and external scripts. Assert the
    // policy never relaxes scripts, and never widens the default beyond 'self'.
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/default-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/default-src[^;]*\*/);
    // External CSS exfil is closed too: images/fonts/connect fall back to 'self'.
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    // style-src DOES allow inline (the renderer's own <style> blocks need it) —
    // documented + harmless for XSS since scripts and external loads are blocked.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});
