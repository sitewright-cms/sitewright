import { afterAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { SCREENSHOT_VIEWPORTS } from '@sitewright/schema';
import { imageSize } from '@sitewright/image-pipeline';
import { settlePage } from '../src/render/screenshot.js';
import { capturePreviewViewport, cdpDriver } from '../src/render/preview-capture.js';
import { COLUMN_GUTTER } from '../src/render/capture-plan.js';
import { launchTestBrowser } from './browser-helper.js';

/**
 * What a capture-prepared page LOOKS like, measured in a real browser: the full-page capture path
 * (settlePage) must not move anything a visitor sees at the top of the page. The decisions behind it
 * are unit-tested in capture-chrome.test.ts; this proves the layout they produce.
 */

const browser = await launchTestBrowser();
afterAll(async () => {
  await browser?.close();
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Page-relative boxes (viewport rect + whatever is scrolled) for each selector. */
async function boxes(page: Page, selectors: string[]): Promise<Record<string, Box>> {
  return page.evaluate((sels) => {
    const d = (globalThis as unknown as { document: { scrollingElement: { scrollTop: number } | null; querySelector(s: string): { getBoundingClientRect(): Box } | null } }).document;
    const y0 = d.scrollingElement?.scrollTop ?? 0;
    const out: Record<string, Box> = {};
    for (const s of sels) {
      const r = d.querySelector(s)?.getBoundingClientRect();
      if (r) out[s] = { x: Math.round(r.x), y: Math.round(r.y + y0), width: Math.round(r.width), height: Math.round(r.height) };
    }
    return out;
  }, selectors);
}

describe.skipIf(!browser)('settlePage keeps sticky and fixed chrome where it lays out', () => {
  it('★ a sticky grid column inside a positioned parent keeps its cell, its width and its offset', async () => {
    // The reported shape: a sticky sidebar column in a 2fr/1fr grid whose wrapper is `relative` and sits
    // well down the page — plus a sticky site header above it. The old capture made both `absolute`: the
    // column shrank to its text and dropped by the wrapper's offset, and the header left the flow so
    // everything under it rode up 64px.
    const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body style="margin:0;font:16px sans-serif">
        <header id="hdr" style="position:sticky;top:0;height:64px;background:#123;color:#fff;z-index:5">Site</header>
        <div id="wrap" style="position:relative;margin:300px auto 0;width:1200px;display:grid;grid-template-columns:2fr 1fr;gap:32px">
          <div id="main" style="height:2600px;background:#eef">Main column</div>
          <div id="col" style="position:sticky;top:96px;align-self:start;height:400px;background:#fde">Sticky column</div>
        </div>
        <div id="fixed-wrap" style="position:relative;margin-top:200px;height:100px">
          <div id="fab" style="position:fixed;top:12px;right:12px;width:120px;height:40px;background:#c06">Fixed</div>
        </div>
        <footer id="after" style="height:200px;background:#111">After</footer>
      </body></html>`);
      const watched = ['#hdr', '#col', '#main', '#after', '#fab'];
      const before = await boxes(page, watched);
      await settlePage(page, { freeze: true });
      const after = await boxes(page, watched);

      for (const sel of ['#hdr', '#col', '#main', '#after']) expect(after[sel], sel).toEqual(before[sel]);
      // Sanity: the column really is in its grid cell (a third of 1200 less the gap), not shrink-to-fit.
      expect(after['#col']!.width).toBe(389);
      // The fixed button keeps the place it had on screen at the top of the page, although its own
      // wrapper is positioned (as `absolute` its `top` would resolve against that wrapper).
      expect(after['#fab']!.y).toBe(before['#fab']!.y);
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe.skipIf(!browser)('settlePage on a preview-shaped page — the BODY scrolls', () => {
  it('a fixed header and a sticky column end up where a visitor sees them, though the body was scrolled', async () => {
    // A preview document scrolls its BODY (overflow:auto), and the capture's own style flips that
    // overflow off mid-settle — measured once leaving the document 4,228px down while window.scrollY
    // still read 0. Any position derived from one of those readings and checked against the other is off
    // by the whole scroll.
    const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html style="height:100%"><body style="margin:0;height:100%;overflow:auto;font:16px sans-serif">
        <div id="shell" style="position:relative">
          <header id="hdr" style="position:fixed;top:0;left:0;right:0;height:64px;background:#123;z-index:5">Site</header>
          <div style="height:64px"></div>
          <div id="wrap" style="position:relative;margin:300px auto 0;width:1200px;display:grid;grid-template-columns:2fr 1fr;gap:32px">
            <div style="height:6000px;background:#eef">Main</div>
            <div id="col" style="position:sticky;top:96px;align-self:start;height:400px;background:#fde">Sticky</div>
          </div>
        </div>
      </body></html>`);
      await page.evaluate(() => {
        (globalThis as unknown as { document: { body: { scrollTop: number } } }).document.body.scrollTop = 4000;
      });
      await settlePage(page, { freeze: true });
      const after = await boxes(page, ['#hdr', '#col']);
      expect(after['#hdr']).toMatchObject({ y: 0, width: 1440 });
      expect(after['#col']).toMatchObject({ y: 64 + 300, width: 389 });
    } finally {
      await context.close();
    }
  }, 60_000);
});

/** A long marketing-style page: ten 900px sections, one of them a 1200px-wide "pricing" block. */
const LONG_PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;font:16px sans-serif">
  ${Array.from({ length: 10 }, (_, i) => `<section style="height:900px;background:hsl(${i * 36} 60% 80%)"><h2 style="margin:0;height:96px;padding:40px;box-sizing:border-box">Section ${i + 1}</h2>${
    i === 3 ? '<div id="pricing" style="width:1200px;max-width:100%;height:500px;margin:0 auto;background:#fff">Pricing</div>' : ''
  }</section>`).join('')}
  </body></html>`;

describe.skipIf(!browser)('preview capture — real images of a long page', () => {
  async function capture(viewport: 'fullhd' | 'mobile', request: { segment: number; selector?: string }, dsf: number) {
    const vp = SCREENSHOT_VIEWPORTS[viewport];
    const context = await browser!.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: dsf, isMobile: vp.isMobile });
    try {
      const page = await context.newPage();
      await page.setContent(LONG_PAGE);
      await settlePage(page, { freeze: true });
      const out = await capturePreviewViewport(cdpDriver(page, await context.newCDPSession(page), 10_000), viewport, vp, request, 0.5);
      const sizes = await Promise.all(out.captures.map((c) => imageSize(Buffer.from(c.base64, 'base64'))));
      return { ...out, sizes };
    } finally {
      await context.close();
    }
  }

  it('★ desktop comes back at a readable 960px wide in two segments — not one 2,000px sliver', async () => {
    const { captures, sizes } = await capture('fullhd', { segment: 1 }, 0.5);
    expect(captures).toHaveLength(2);
    expect(sizes).toEqual([
      { width: 960, height: 1354 },
      { width: 960, height: 1354 },
    ]);
    expect(captures[0]!.totalHeight).toBe(9000);
    expect(captures[0]!.segmentCount).toBe(4);
  }, 60_000);

  it('the phone view is ONE image of side-by-side columns, the whole page', async () => {
    const { captures, sizes } = await capture('mobile', { segment: 1 }, 0.5);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.segments.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(sizes[0]).toEqual({ width: 3 * 195 + 2 * COLUMN_GUTTER, height: 1568 });
  }, 60_000);

  it('an element is captured on its own, at full resolution', async () => {
    const { captures, sizes, notes } = await capture('fullhd', { segment: 1, selector: '#pricing' }, 1);
    expect(notes).toEqual([]);
    expect(sizes).toEqual([{ width: 1200, height: 500 }]);
    expect(captures[0]!.segments[0]).toEqual({ index: 1, top: 2700 + 96, bottom: 2700 + 96 + 500 });
  }, 60_000);
});
