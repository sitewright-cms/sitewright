import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { _optimizeGateAdmittedForTest } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';
import { makePng } from './png.js';

// A cold single-page preview of an image-heavy page asks for every image at once (lazy loading is off
// there on purpose). Those encodes went only through the PUBLIC thumbnail gate — three at a time, and a
// project's share of its queue — so most of such a page was refused with a 503 and the browser only
// tried again seconds later. Now the variants a member's preview references are admitted the way a
// build's encodes are, and wait for a slot instead of being refused. Everything else is unchanged.

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
const IMAGES = 12;

let h: Harness;
let author: TestClient;
let previewRoot = '';
let mediaRoot = '';

beforeAll(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-encode-lane-preview-'));
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-encode-lane-media-'));
  h = await makeHarness({ previewRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
  author = await h.signup();
});
afterAll(async () => {
  await h.close();
  await rm(previewRoot, { recursive: true, force: true });
  await rm(mediaRoot, { recursive: true, force: true });
});

/** A project whose home page shows IMAGES uploaded photos through {{sw-image}}. */
async function galleryProject(): Promise<{ pid: string; page: Record<string, unknown>; urls: string[] }> {
  const pid = await author.createProject();
  const urls: string[] = [];
  for (let i = 0; i < IMAGES; i++) {
    const boundary = 'SWLANE';
    const up = await author.inject({
      method: 'POST',
      url: `/projects/${pid}/media`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p${i}.png"\r\nContent-Type: image/png\r\n\r\n`),
        makePng(2000, 1400, [10 + i * 15, 120, 90]),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(up.statusCode, up.body).toBe(201);
    urls.push((up.json() as { item: { url: string } }).item.url);
  }
  const page = { id: 'home', path: '', title: 'Home', source: `<section>${urls.map((u, i) => `{{sw-image "${u}" alt="p${i}"}}`).join('')}</section>` };
  expect((await author.project(pid).putContent('page', 'home', page)).statusCode).toBe(200);
  return { pid, page, urls };
}

/** Every srcset rung of every image on the page, requested at once by an anonymous client (as the canvas does). */
async function requestAll(paths: string[]): Promise<number[]> {
  return Promise.all(paths.map(async (url) => (await h.app.inject({ method: 'GET', url })).statusCode));
}

function rungs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const cand of m[1]!.split(',')) out.add(cand.trim().split(/\s+/)[0]!.replace(/&amp;/g, '&'));
  }
  return [...out].filter((u) => u.startsWith('/media/'));
}

describe('a single-page preview’s images are encoded the way a build’s are', () => {
  it('★ every image of a cold previewed page loads at once — none is refused as busy', async () => {
    const previewed = await galleryProject();
    const res = await author.post(`/projects/${previewed.pid}/preview`, previewed.page);
    expect(res.statusCode, res.body).toBe(200);
    const paths = rungs((res.json() as { html: string }).html);
    // More than the public gate's three running plus a project's twenty queued.
    expect(paths.length).toBeGreaterThan(23);
    const publicBefore = _optimizeGateAdmittedForTest();
    const statuses = await requestAll(paths);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    // …and the build gate took some of them: the public gate did not encode them all.
    expect(_optimizeGateAdmittedForTest() - publicBefore).toBeLessThan(paths.length);
  });

  it('…while the same requests for a project nobody previewed still meet the public gate, as before', async () => {
    // The presence guard for the test above: the same burst DOES saturate the public gate, so its
    // all-200 is the lane's doing. A URL is not a member's preview.
    const cold = await galleryProject();
    const previewed = await galleryProject();
    const res = await author.post(`/projects/${previewed.pid}/preview`, previewed.page);
    const paths = rungs((res.json() as { html: string }).html);
    // The same page's rungs, but this project's own asset URLs: swap each previewed url for its twin.
    const twin = new Map(previewed.urls.map((u, i) => [u, cold.urls[i]!]));
    const coldPaths = paths.map((p) => {
      const [path, query] = p.split('?');
      return `${twin.get(path!) ?? path}${query ? `?${query}` : ''}`;
    });
    expect(coldPaths.some((p, i) => p !== paths[i])).toBe(true);
    expect(coldPaths.length).toBeGreaterThan(23);
    const statuses = await requestAll(coldPaths);
    expect(statuses.filter((s) => s === 503).length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 200 || s === 503)).toBe(true);
  });
});
