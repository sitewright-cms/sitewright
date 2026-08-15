import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { seedUser } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

/**
 * `POST /projects/:id/media/import-url` — the guards around the byte cap, over HTTP.
 *
 * Background: this route is the ONLY URL-based import, and it used to hand every media type the
 * 15MB IMAGE cap. A site's 83MB video therefore could not be imported by URL even though the store,
 * the `video` media kind and the local-upload paths all accept 200MB — so a clone agent hotlinked it
 * instead. The cap is now chosen from the URL extension and then RE-CHECKED against the real
 * Content-Type once the bytes arrive, so a `.mp4` name cannot smuggle a large image past the image
 * ceiling.
 *
 * WHAT IS DELIBERATELY *NOT* TESTED HERE: the byte-cap arithmetic itself. E2E talks to a deployed
 * container and cannot inject a fetcher, so asserting the caps would mean pulling >15MB from a third
 * party on every run — slow, and flaky in exactly the way a gate must not be. That logic is covered
 * where the fetcher IS injectable, in apps/api/test/import-url.test.ts (both the raised playable cap
 * and the Content-Type re-check). These specs cover what only a real deployment can show: that the
 * route is reachable, that its refusals still refuse, and that the 413 an agent reads is actionable.
 *
 * The real large-media import runs only when SW_E2E_LARGE_VIDEO_URL is provided, matching how
 * stock.spec.ts gates its keyed provider calls — so a default run stays hermetic.
 */

const LARGE_VIDEO_URL = process.env.SW_E2E_LARGE_VIDEO_URL;

async function newProject(playwright: PwFixture, baseURL: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `media-${stamp}@e2e.test`);
  const proj = await ctx.post(`/projects`, { data: { name: 'Media', slug: `m${stamp}` } });
  expect(proj.status(), 'creating the project').toBe(201);
  return { ctx, base: `/projects/${(await proj.json()).project.id}` };
}

test('import-url still refuses what it always refused (the cap change must not widen the guard)', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);

  // Plain http, and a private/loopback target — the SSRF boundary runs BEFORE the cap is chosen,
  // so a change to cap selection must leave both refusals exactly where they were.
  for (const url of ['http://cdn.example.com/x.png', 'https://127.0.0.1/x.mp4', 'https://localhost/x.mp4']) {
    const res = await ctx.post(`${base}/media/import-url`, { data: { url } });
    expect([400, 403], `${url} must be refused`).toContain(res.status());
  }
});

test('a video-named URL is still subject to the SSRF guard, not waved through by its extension', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  // The extension picks the CAP, nothing else. It must not become a way past the host checks.
  const res = await ctx.post(`${base}/media/import-url`, { data: { url: 'https://169.254.169.254/meta.mp4' } });
  expect([400, 403]).toContain(res.status());
  expect(JSON.stringify(await res.json()), 'no internal DNS/host detail may leak').not.toMatch(/169\.254\.169\.254 resolved|ENOTFOUND|EAI_/);
});

test('an unreachable URL fails as a fetch error, not a crash', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  const res = await ctx.post(`${base}/media/import-url`, {
    data: { url: 'https://this-host-does-not-exist-e2e.invalid/clip.mp4' },
  });
  expect(res.status(), 'a dead host is a 4xx, never a 500').toBeGreaterThanOrEqual(400);
  expect(res.status()).toBeLessThan(500);
});

test.describe('real large media (needs SW_E2E_LARGE_VIDEO_URL)', () => {
  test.skip(!LARGE_VIDEO_URL, 'set SW_E2E_LARGE_VIDEO_URL to a public >15MB video to run this');

  test('imports a video that the old image-sized cap would have refused', async ({ playwright, baseURL }) => {
    test.setTimeout(180_000);
    const { ctx, base } = await newProject(playwright, baseURL!);
    const res = await ctx.post(`${base}/media/import-url`, {
      data: { url: LARGE_VIDEO_URL, folder: 'Video' },
    });
    expect(res.status(), 'a large playable asset must import by URL').toBe(201);
    const item = (await res.json()).item;
    expect(item.kind, 'and be stored as playable video, not a download').toBe('video');
    expect(item.bytes).toBeGreaterThan(15 * 1024 * 1024);

    // It must be SELF-HOSTED and actually served — the whole point was to stop hotlinking.
    const served = await ctx.get(item.url);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toMatch(/^video\//);
  });
});
