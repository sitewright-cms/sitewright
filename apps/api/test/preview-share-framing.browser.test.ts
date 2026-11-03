import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchTestBrowser } from './browser-helper.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * What a REAL browser does with a preview share link's framing headers. jsdom enforces no CSP, so the
 * header tests (preview-share-framing.test.ts) cannot show that a site on the allowlist can actually
 * frame a share link and a site off it cannot. Three origins on 127.0.0.1, told apart by port: the app,
 * an allowlisted embedder and another site.
 */

const browser = await launchTestBrowser();
const DRAFT_TEXT = 'Shared Draft In A Frame';

/** A one-page "site" that frames `src`. Its origin is http://127.0.0.1:<port>. */
async function embedder(src: () => string): Promise<{ server: Server; origin: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>embedder</title><iframe id="f" src="${src()}" style="width:800px;height:600px"></iframe>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe.skipIf(!browser)('a real browser enforces the share-link framing allowlist', () => {
  let previewRoot: string;
  let h: Harness;
  let admin: TestClient;
  let appOrigin: string;
  let shareUrl: string;
  let defaultUrl: string;
  let target = '';
  const sites: Array<{ server: Server; origin: string }> = [];

  beforeAll(async () => {
    previewRoot = await mkdtemp(join(tmpdir(), 'sw-share-frame-browser-'));
    h = await makeHarness({ previewRoot, cookieSecret: 'share-frame-browser-secret' });
    admin = await h.signup({ admin: true });
    const projectId = await admin.createProject('Site', 'site', { localHosting: false });
    await admin.project(projectId).putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: `<h1>${DRAFT_TEXT}</h1>` });
    shareUrl = ((await admin.post(`/projects/${projectId}/preview-shares`, { label: 'Lead Engine' })).json() as { url: string }).url;
    defaultUrl = ((await admin.get(`/projects/${projectId}/preview-url`)).json() as { base: string }).base;
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    appOrigin = `http://127.0.0.1:${(h.app.server.address() as AddressInfo).port}`;
    sites.push(await embedder(() => target), await embedder(() => target));
  });
  afterAll(async () => {
    await browser?.close();
    for (const s of sites) await new Promise((resolve) => s.server.close(resolve));
    await h?.close();
    if (previewRoot) await rm(previewRoot, { recursive: true, force: true });
  });

  const allowed = () => sites[0]!.origin;
  const other = () => sites[1]!.origin;
  async function setAllowlist(origins: string[] | null): Promise<void> {
    const res = await admin.put('/admin/settings', { shareEmbedding: origins ? { origins } : null });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** Opens `pageUrl` (a page that frames `frameUrl`) and reports whether the draft actually rendered inside. */
  async function framedDraft(pageUrl: string, frameUrl: string, opts: { inject?: boolean } = {}): Promise<{ shown: boolean; refused: boolean }> {
    target = frameUrl;
    const context = await browser!.newContext();
    try {
      const page = await context.newPage();
      const refusals: string[] = [];
      page.on('console', (m) => {
        if (/Refused to (display|frame)/i.test(m.text())) refusals.push(m.text());
      });
      await page.goto(pageUrl, { waitUntil: 'load' });
      if (opts.inject) {
        // A page ON the app origin framing the link: add the iframe to whatever document is there.
        await page.evaluate(
          (src) =>
            new Promise<void>((resolve) => {
              const d = (globalThis as unknown as { document: { createElement(t: string): { src: string; id: string; onload: () => void }; body: { appendChild(n: unknown): void } } }).document;
              const f = d.createElement('iframe');
              f.id = 'f';
              f.onload = () => resolve();
              f.src = src;
              d.body.appendChild(f);
            }),
          frameUrl,
        );
      }
      const frame = await (await page.$('#f'))!.contentFrame();
      const text = await frame!.evaluate(() => (globalThis as unknown as { document: { body?: { innerText: string } } }).document.body?.innerText ?? '').catch(() => '');
      return { shown: text.includes(DRAFT_TEXT), refused: refusals.length > 0 || frame!.url().startsWith('chrome-error:') };
    } finally {
      await context.close();
    }
  }

  it('with no allowlist, another site cannot frame a share link, and the app itself still can', async () => {
    await setAllowlist(null);
    expect(await framedDraft(allowed(), `${appOrigin}${shareUrl}`)).toEqual({ shown: false, refused: true });
    expect(await framedDraft(`${appOrigin}/health`, `${appOrigin}${shareUrl}`, { inject: true })).toEqual({ shown: true, refused: false });
  });

  it('★ with the allowlist set, the listed site can frame a share link and another site cannot', async () => {
    await setAllowlist([allowed()]);
    expect(await framedDraft(allowed(), `${appOrigin}${shareUrl}`)).toEqual({ shown: true, refused: false });
    expect(await framedDraft(other(), `${appOrigin}${shareUrl}`)).toEqual({ shown: false, refused: true });
    // 'self' stays in the list, so the app can still frame its own share links.
    expect(await framedDraft(`${appOrigin}/health`, `${appOrigin}${shareUrl}`, { inject: true })).toEqual({ shown: true, refused: false });
  });

  it('the listed site still cannot frame the member-only preview URL', async () => {
    await setAllowlist([allowed()]);
    expect(await framedDraft(allowed(), `${appOrigin}${defaultUrl}`)).toEqual({ shown: false, refused: true });
  });
});
