import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';
import { makePng } from './png.js';
import { PREVIEW_IMAGE_RETRY_JS } from '../src/http/preview-image-retry.js';

// The single-page preview renders {{sw-image}} in the format the SITE ships: the project's
// `website.imageDelivery`, else the instance's `defaultImageFormat`. It used to ignore both and always
// render plain WebP, while the whole-site preview and the published site wore the AVIF <picture>.

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
const AVIF_PICTURE = '<picture><source type="image/avif"';

let h: Harness;
let admin: TestClient;
let author: TestClient;
let previewRoot = '';
let mediaRoot = '';

beforeAll(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-img-delivery-preview-'));
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-img-delivery-media-'));
  h = await makeHarness({ previewRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
  admin = await h.signup({ admin: true });
  author = await h.signup();
});
afterAll(async () => {
  await h.close();
  await rm(previewRoot, { recursive: true, force: true });
  await rm(mediaRoot, { recursive: true, force: true });
});

async function setInstanceDefault(format: 'avif' | null): Promise<void> {
  const res = await admin.put('/admin/settings', { defaultImageFormat: format });
  expect(res.statusCode, res.body).toBe(200);
}

/** A project whose home page AND footer show one uploaded photo through {{sw-image}}. */
async function projectWithPhoto(imageDelivery?: 'webp' | 'avif'): Promise<{ pid: string; page: Record<string, unknown> }> {
  const pid = await author.createProject();
  const boundary = 'SWDELIVERY';
  const up = await author.inject({
    method: 'POST',
    url: `/projects/${pid}/media`,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
      makePng(1200, 800, [10, 120, 90]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  expect(up.statusCode, up.body).toBe(201);
  const url = (up.json() as { item: { url: string } }).item.url;
  const settings = await author.project(pid).putContent('settings', 'settings', {
    identity: { name: 'Acme' },
    website: { footer: `<div id="foot">{{sw-image "${url}" alt="F"}}</div>`, ...(imageDelivery ? { imageDelivery } : {}) },
    settings: {},
  });
  expect(settings.statusCode, settings.body).toBe(200);
  const page = { id: 'home', path: '', title: 'Home', source: `<section id="body">{{sw-image "${url}" alt="B"}}</section>` };
  const saved = await author.project(pid).putContent('page', 'home', page);
  expect(saved.statusCode, saved.body).toBe(200);
  return { pid, page };
}

async function singlePage(pid: string, page: Record<string, unknown>): Promise<string> {
  const res = await author.post(`/projects/${pid}/preview`, page);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { html: string }).html;
}

async function wholeSite(pid: string): Promise<string> {
  const { base } = (await author.get(`/projects/${pid}/preview-url`)).json() as { base: string };
  const res = await author.get(base);
  expect(res.statusCode).toBe(200);
  return res.body;
}

/** Whether the element with `id` holds the AVIF <picture> (vs a single WebP <img>). */
function avifIn(html: string, id: string): boolean {
  // (The preview stamps editor markers onto a slot's root, so attributes may follow the id.)
  const m = new RegExp(`<(section|div) id="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  expect(m, `#${id} rendered`).not.toBeNull();
  expect(m![2]).toContain('<img ');
  return m![2]!.includes(AVIF_PICTURE);
}

describe('{{sw-image}} delivery format — the single-page preview agrees with the site', () => {
  const cases: Array<{ name: string; instance: 'avif' | null; project?: 'webp' | 'avif'; avif: boolean }> = [
    { name: 'nothing chosen → WebP', instance: null, avif: false },
    { name: 'the project chose AVIF → AVIF', instance: null, project: 'avif', avif: true },
    { name: 'the instance default is AVIF and the project chose nothing → AVIF', instance: 'avif', avif: true },
    { name: 'the instance default is AVIF but the project chose WebP → WebP (the project wins)', instance: 'avif', project: 'webp', avif: false },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      await setInstanceDefault(c.instance);
      try {
        const { pid, page } = await projectWithPhoto(c.project);
        const single = await singlePage(pid, page);
        // The page body AND a slot: build.ts renders both with the same imageAvif.
        expect(avifIn(single, 'body')).toBe(c.avif);
        expect(avifIn(single, 'foot')).toBe(c.avif);
        // The whole-site build is the reference — the rule now lives in one function both call.
        const site = await wholeSite(pid);
        expect(avifIn(site, 'body')).toBe(c.avif);
        expect(avifIn(site, 'foot')).toBe(c.avif);
      } finally {
        await setInstanceDefault(null);
      }
    }, 30_000);
  }
});

describe('the single-page preview retries an image the server was too busy to encode', () => {
  it('ships the retry runtime in <head>, so it is listening before the first image can fail', async () => {
    const { pid, page } = await projectWithPhoto();
    const single = await singlePage(pid, page);
    // ONE needle for both checks, so the absence below can't pass because the script was rewritten.
    const needle = PREVIEW_IMAGE_RETRY_JS.slice(0, 400);
    const head = single.slice(0, single.indexOf('</head>'));
    expect(head).toContain(needle);
    // Preview-only: the built site links pre-built files and never carries it.
    expect(await wholeSite(pid)).not.toContain(needle);
  }, 30_000);
});
