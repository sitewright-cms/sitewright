import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

// The single-page preview renders in the worker pool; without one the route 503s.
const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

/**
 * INTEGRATION: `{{ website.json_data }}` in the PREVIEW, before any publish.
 *
 * ★ THE GAP THIS CLOSES. The single-page preview never fetched the source at all — the binding
 * rendered empty and stayed empty until a publish, so an author building a page against a remote
 * feed was designing blind against a hole in the layout. It could not simply start fetching either:
 * that route renders on every keystroke, so a bare fetch would be a round trip per character and, on
 * an unreachable host, the full 8s timeout per character. The answer is a cached snapshot the preview
 * surfaces share, warmed when the URL is saved.
 *
 * What is asserted here is the OBSERVABLE half — the data reaching a rendered page, the read happening
 * once rather than per render, and a broken source being reportable. The cache's own mechanics (TTL,
 * negative caching, coalescing, LRU bound) are unit-tested in json-data-cache.test.ts.
 */
describe('website.json_data in the preview', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  /** Every outbound request the fetch stub saw — the count IS the "no network per keystroke" claim. */
  let fetched: string[];

  const FEED = 'https://feed.example.com/data.json';
  const PAYLOAD = { headline: 'Live from the feed', items: [{ title: 'First item' }, { title: 'Second item' }] };

  /** A page whose body only renders if the remote payload actually arrived. */
  const PAGE_SOURCE =
    '<h1>{{ website.json_data.headline }}</h1>' +
    '<ul>{{#each website.json_data.items}}<li>{{ this.title }}</li>{{/each}}</ul>';

  function stubFeed(body: unknown, init?: { status?: number }) {
    vi.stubGlobal('fetch', async (url: string | URL) => {
      fetched.push(String(url));
      if (init?.status && init.status !== 200) return new Response('nope', { status: init.status });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  beforeEach(async () => {
    fetched = [];
    harness = await makeHarness({ renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Feed', 'feed');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  /** Save settings carrying the feed URL — this is what warms the cache. */
  async function saveFeedUrl(url: string) {
    const res = await client.project(projectId).putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      website: { jsonDataUrl: url },
      settings: {},
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  const readStatus = () => client.get(`/projects/${projectId}/json-data`);

  /** Poll the status route until the save's background warm has landed. */
  async function awaitWarm() {
    await vi.waitFor(async () => {
      const res = await readStatus();
      expect((res.json() as { awaiting?: boolean }).awaiting).not.toBe(true);
    });
  }

  const renderPreview = () =>
    client.post(`/projects/${projectId}/preview`, { id: 'home', path: '', title: 'Home', source: PAGE_SOURCE });

  it('renders the remote payload in the single-page preview, with no publish', async () => {
    stubFeed(PAYLOAD);
    await saveFeedUrl(FEED);
    await awaitWarm();

    const res = await renderPreview();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('Live from the feed');
    expect(res.body).toContain('First item');
    expect(res.body).toContain('Second item');
  });

  it('…and 25 renders in a row cost ZERO further requests', async () => {
    // The reason the preview did not do this before. One save, one read; typing is free.
    stubFeed(PAYLOAD);
    await saveFeedUrl(FEED);
    await awaitWarm();
    const afterWarm = fetched.length;
    expect(afterWarm).toBe(1);

    for (let i = 0; i < 25; i++) {
      const res = await renderPreview();
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Live from the feed'); // still rendering the data, not just quiet
    }
    expect(fetched.length).toBe(afterWarm);
  });

  it('a source that cannot be read leaves the page standing and is REPORTABLE', async () => {
    // ★ Both failure modes are invisible in the render itself: a 404 source and an empty source each
    // produce a page with nothing in the binding. The status route is the only place they differ.
    stubFeed(null, { status: 404 });
    await saveFeedUrl(FEED);
    await awaitWarm();

    const res = await renderPreview();
    expect(res.statusCode).toBe(200); // a tenant's dead JSON host must not 500 the editor
    expect(res.body).not.toContain('Live from the feed');

    const status = await readStatus();
    const body = status.json() as { configured: boolean; ok: boolean; error?: string; url?: string };
    expect(body.configured).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/404/);
    expect(body.url).toBe(FEED);
  });

  it('reports a source that IS readable but empty — the case that looks like success', async () => {
    stubFeed({});
    await saveFeedUrl(FEED);
    await awaitWarm();

    const status = await readStatus();
    const body = status.json() as { ok: boolean; bytes: number };
    expect(body.ok).toBe(true); // it worked…
    expect(body.bytes).toBe(2); // …and returned "{}", which will render nothing
  });

  it('reports "not configured" when no URL is set, and never reaches the network', async () => {
    stubFeed(PAYLOAD);
    const res = await readStatus();
    expect(res.json()).toEqual({ configured: false });
    expect(fetched).toHaveLength(0);
  });

  it('changing the URL re-reads it — the old payload answers a different question', async () => {
    stubFeed(PAYLOAD);
    await saveFeedUrl(FEED);
    await awaitWarm();
    expect(fetched).toEqual([FEED]);

    stubFeed({ headline: 'Second feed', items: [] });
    const OTHER = 'https://feed.example.com/other.json';
    await saveFeedUrl(OTHER);
    await awaitWarm();

    const res = await renderPreview();
    expect(res.body).toContain('Second feed');
    expect(res.body).not.toContain('Live from the feed');
    expect(fetched).toEqual([FEED, OTHER]);
  });

  it('the WHOLE-SITE draft preview shares the same snapshot — no fetch per rebuild', async () => {
    // ★ The other half of the leak. Any content change rebuilds the whole draft site, so the old
    // per-rebuild fetch polled a tenant's JSON host at the author's typing speed. Needs its own
    // harness because the `/preview-site/*` routes only exist when a previewRoot is configured.
    stubFeed(PAYLOAD);
    const previewRoot = await mkdtemp(join(tmpdir(), 'sw-jd-preview-'));
    const h2 = await makeHarness({ previewRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    try {
      const c2 = await h2.signup();
      const pid = await c2.createProject('Feed2', 'feed2');
      await c2.project(pid).putContent('settings', 'settings', {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        website: { jsonDataUrl: FEED },
        settings: {},
      });
      await c2.project(pid).putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: PAGE_SOURCE });
      await vi.waitFor(async () => {
        const r = await c2.get(`/projects/${pid}/json-data`);
        expect((r.json() as { awaiting?: boolean }).awaiting).not.toBe(true);
      });
      const afterWarm = fetched.length;
      expect(afterWarm).toBe(1);

      // Build the draft site, then edit and rebuild twice more.
      const base = (await c2.get(`/projects/${pid}/preview-url`)).json() as { base: string };
      const home = await c2.get(base.base);
      expect(home.statusCode).toBe(200);
      expect(home.body).toContain('Live from the feed'); // the feed really reached the built page

      for (const title of ['Home 2', 'Home 3']) {
        await c2.project(pid).putContent('page', 'home', { id: 'home', path: '', title, source: PAGE_SOURCE });
        expect((await c2.get(base.base)).statusCode).toBe(200);
      }
      expect(fetched.length).toBe(afterWarm); // three builds, still ONE read
    } finally {
      await h2.close();
      await rm(previewRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('a private-host URL is refused by the SSRF guard, and says so', async () => {
    // The URL is tenant-controlled, so the preview is an SSRF sink exactly like publish. The guard
    // lives in fetchJsonData; this asserts the preview path really goes through it.
    stubFeed(PAYLOAD);
    await saveFeedUrl('https://192.168.1.10/data.json');
    await awaitWarm();

    const status = await readStatus();
    const body = status.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/public https/i);
    expect(fetched).toHaveLength(0); // refused BEFORE any request left the process
  });
});
