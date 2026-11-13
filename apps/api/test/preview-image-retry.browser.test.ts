import { afterAll, describe, expect, it } from 'vitest';
import type { Page, Route } from 'playwright-core';
import { launchTestBrowser } from './browser-helper.js';
import { makePng } from './png.js';
import { PREVIEW_IMAGE_RETRY_JS } from '../src/http/preview-image-retry.js';

/**
 * The single-page preview's image retry, in a REAL browser: only a browser decides whether re-setting an
 * `<img>`'s own `src`/`srcset` fetches again after a failure, and which `<picture>` source it picks.
 * The server's busy answer is simulated per URL (503 for the first N requests), and the page clock is
 * fast-forwarded so the back-off does not cost the suite forty real seconds.
 */

const browser = await launchTestBrowser();
const ORIGIN = 'http://sw-preview.test';
const PNG = makePng(40, 30, [10, 120, 90]);
const MAX_RETRIES = 10;

/** Serves `body` (the retry script in <head>, or none) and answers each media path by `plan`. */
async function open(body: string, plan: Record<string, number | 'never' | 404>, opts: { headScript?: boolean } = {}) {
  const context = await browser!.newContext();
  const hits: Record<string, number> = {};
  await context.route('**/*', (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && url.pathname === '/') {
      const head = opts.headScript === false ? '' : `<script>${PREVIEW_IMAGE_RETRY_JS}</script>`;
      // Under the same sandbox CSP the preview route serves the canvas with (opaque origin, scripts on).
      return route.fulfill({
        contentType: 'text/html',
        headers: { 'content-security-policy': "sandbox allow-scripts; default-src 'self'; script-src 'unsafe-inline'; img-src 'self' https:" },
        body: `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
      });
    }
    const key = url.pathname + url.search;
    hits[key] = (hits[key] ?? 0) + 1;
    const rule = plan[url.pathname] ?? 0;
    if (rule === 404) return route.fulfill({ status: 404, body: 'not found' });
    if (rule === 'never' || hits[key]! <= rule) return route.fulfill({ status: 503, headers: { 'retry-after': '2' }, body: 'server busy' });
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${ORIGIN}/`);
  return { context, page, hits };
}

/**
 * Advances the page clock past one back-off at a time (the longest is 7.5 s) until `done()` holds,
 * polling — not sleeping a fixed time — for each retry's fetch to land. Then `settle` more steps, so a
 * test can also prove that nothing ELSE is requested afterwards.
 */
async function drain(page: Page, done: () => boolean | Promise<boolean>, settle = 2): Promise<void> {
  for (let i = 0; i < 4 * MAX_RETRIES && !(await done()); i++) {
    await page.clock.runFor(8000);
    await page.waitForTimeout(25);
  }
  expect(await done()).toBe(true);
  for (let i = 0; i < settle; i++) {
    await page.clock.runFor(8000);
    await page.waitForTimeout(100);
  }
}

const loaded = (page: Page, id: string) => page.evaluate<number>(`document.getElementById(${JSON.stringify(id)}).naturalWidth`);
const total = (hits: Record<string, number>, path: string) =>
  Object.entries(hits).filter(([k]) => k.startsWith(path)).reduce((n, [, v]) => n + v, 0);

describe.skipIf(!browser)('the single-page preview retries an image the server was too busy to encode', () => {
  afterAll(async () => {
    await browser?.close();
  });

  it('an <img src> refused twice loads on the third request', async () => {
    const { context, page, hits } = await open('<img id="a" src="/media/p/a1-a.png?size=md" alt="">', { '/media/p/a1-a.png': 2 });
    await drain(page, async () => (await loaded(page, 'a')) > 0);
    expect(await loaded(page, 'a')).toBe(40);
    expect(hits['/media/p/a1-a.png?size=md']).toBe(3);
    await context.close();
  });

  it('a responsive <img srcset> and a <picture> with an AVIF source load too, and the markup is untouched', async () => {
    const body =
      '<img id="b" src="/media/p/a2-b.png?size=xl" srcset="/media/p/a2-b.png?size=sm 500w, /media/p/a2-b.png?size=md 1000w" sizes="100vw" alt="">' +
      '<picture><source type="image/avif" srcset="/media/p/a3-c.png?size=sm&amp;format=avif 500w"><img id="c" src="/media/p/a3-c.png?size=sm" alt=""></picture>';
    const { context, page, hits } = await open(body, { '/media/p/a2-b.png': 1, '/media/p/a3-c.png': 1 });
    const before = await page.evaluate<string>('document.body.innerHTML');
    await drain(page, async () => (await loaded(page, 'b')) > 0 && (await loaded(page, 'c')) > 0);
    // (A srcset image's naturalWidth is scaled by the chosen candidate's density — loaded is all that counts.)
    expect(await loaded(page, 'b')).toBeGreaterThan(0);
    expect(await loaded(page, 'c')).toBeGreaterThan(0);
    // The <picture> retried its AVIF candidate, not the fallback src.
    expect(hits['/media/p/a3-c.png?size=sm&format=avif']).toBe(2);
    // ★ No attribute written onto the elements: the bridge saves edited regions' HTML back into the page.
    expect(await page.evaluate<string>('document.body.innerHTML')).toBe(before);
    expect(total(hits, '/media/p/a2-b.png')).toBe(2);
    await context.close();
  });

  it(`gives up after ${MAX_RETRIES} retries — an image that is really gone is not a loop`, async () => {
    const { context, page, hits } = await open('<img id="d" src="/media/p/a4-gone.png" alt="">', { '/media/p/a4-gone.png': 404 });
    await drain(page, () => (hits['/media/p/a4-gone.png'] ?? 0) >= 1 + MAX_RETRIES, 4);
    expect(hits['/media/p/a4-gone.png']).toBe(1 + MAX_RETRIES);
    expect(await loaded(page, 'd')).toBe(0);
    await context.close();
  });

  it('leaves alone what is not a project raster: another host, and an SVG', async () => {
    // …and a name merely ENDING in "svg" is still retried: it pins the escaped dot in the SVG test (an
    // unescaped /.svg$/ would match "logosvg" and skip it).
    const body =
      '<img id="e" src="https://cdn.example.test/media/x.png" alt=""><img id="f" src="/media/p/a5-v.svg" alt="">' +
      '<img id="h" src="/media/p/a7-logosvg?size=md" alt="">';
    const { context, page, hits } = await open(body, { '/media/x.png': 'never', '/media/p/a5-v.svg': 'never', '/media/p/a7-logosvg': 1 });
    await drain(page, async () => (await loaded(page, 'h')) > 0, 3);
    expect(hits['/media/x.png']).toBe(1);
    expect(hits['/media/p/a5-v.svg']).toBe(1);
    expect(hits['/media/p/a7-logosvg?size=md']).toBe(2);
    await context.close();
  });

  it('a loaded image gets its full budget back, so a later swap is retried as many times again', async () => {
    const { context, page, hits } = await open('<img id="i" src="/media/p/a8-one.png?size=md" alt="">', {
      '/media/p/a8-one.png': 3,
      '/media/p/a9-two.png': MAX_RETRIES,
    });
    await drain(page, async () => (await loaded(page, 'i')) > 0);
    // A carousel / data-sw-src swap: a new file, refused as many times as the whole budget allows.
    await page.evaluate("document.getElementById('i').setAttribute('src', '/media/p/a9-two.png?size=md')");
    await drain(page, async () => (await page.evaluate<string>("document.getElementById('i').currentSrc")).includes('a9-two') && (await loaded(page, 'i')) > 0);
    expect(hits['/media/p/a9-two.png?size=md']).toBe(1 + MAX_RETRIES);
    await context.close();
  });

  it('run AFTER an image already failed (a raw-replica page has it at the end of <body>), it still retries that image', async () => {
    const { context, page, hits } = await open('<img id="g" src="/media/p/a6-g.png?size=md" alt="">', { '/media/p/a6-g.png': 1 }, { headScript: false });
    await expect.poll(() => page.evaluate<boolean>("document.getElementById('g').complete")).toBe(true);
    expect(await loaded(page, 'g')).toBe(0);
    await page.evaluate(PREVIEW_IMAGE_RETRY_JS);
    await drain(page, async () => (await loaded(page, 'g')) > 0);
    expect(await loaded(page, 'g')).toBe(40);
    expect(hits['/media/p/a6-g.png?size=md']).toBe(2);
    await context.close();
  });
});
