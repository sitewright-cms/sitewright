import { afterAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { componentAssets } from '@sitewright/blocks';
import { launchTestBrowser } from './browser-helper.js';

/**
 * A lightbox gallery whose items sit in an AUTOPLAYING carousel (kayec.org.na's donor posters), run
 * with the real shipped runtimes in a real browser. Each slide change rewrites the carousel's live
 * region inside the lightbox root, and the lightbox's "items added later" watcher used to rebuild the
 * gallery on that — destroying the OPEN viewer on the next autoplay tick and leaving the page at
 * `overflow: hidden`, unable to scroll. jsdom has no layout for Embla to slide in, so only a browser
 * shows the two runtimes meeting.
 */

const browser = await launchTestBrowser();

const poster = (n: number): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#${(n * 2 + 3).toString(16).repeat(3).slice(0, 6)}"/></svg>`)}`;

const slides = Array.from(
  { length: 6 },
  (_, i) =>
    `<figure data-sw-part="slide" class="px-2"><a href="${poster(i)}" data-caption="Donor ${i + 1}"><img src="${poster(i)}" alt="Poster ${i + 1}" width="600" height="400" style="display:block;width:100%"></a></figure>`,
).join('');

function pageHtml(css: string): string {
  return `<!doctype html><html><head><style>${css}</style></head><body style="margin:0">
<div data-sw-component="lightbox" data-thumbnails="false">
  <div style="--sw-items:2.15" data-sw-component="carousel" data-effect="slide" data-item-align="start" data-autoplay="true" data-interval="600" data-arrows="circle" aria-label="Donor posters">
    <div data-sw-part="track">${slides}</div>
    <button type="button" data-sw-part="prev" aria-label="Previous poster">‹</button>
    <button type="button" data-sw-part="next" aria-label="Next poster">›</button>
    <div data-sw-part="dots" aria-hidden="true"></div>
  </div>
</div>
<div style="height:3000px">below the slider</div>
</body></html>`;
}

// Page-side code as string expressions: this package type-checks without the DOM lib.
const liveText = (page: Page): Promise<string> =>
  page.evaluate<string>(`document.querySelector('[data-sw-component="carousel"] .sw-sr-only')?.textContent ?? ''`);

interface ViewerState {
  viewers: number;
  open: number;
  wrappers: number;
  bodyOverflow: string;
}
const viewer = (page: Page): Promise<ViewerState> =>
  page.evaluate<ViewerState>(`({
    viewers: document.querySelectorAll('.sw-lightbox').length,
    open: document.querySelectorAll('.sw-lightbox[aria-hidden="false"]').length,
    wrappers: document.querySelectorAll('body > div[data-id]').length,
    bodyOverflow: document.body.style.overflow,
  })`);
const scrollY = (page: Page): Promise<number> => page.evaluate<number>('window.scrollY');

describe.skipIf(!browser)('a lightbox opened from an autoplaying carousel (real browser)', () => {
  afterAll(async () => {
    await browser?.close();
  });

  it('stays open across autoplay ticks, and the page scrolls again once it is closed', async () => {
    const context = await browser!.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const carousel = componentAssets(['Carousel']);
    const lightbox = componentAssets(['Lightbox']);
    await page.setContent(pageHtml(`${carousel.css}\n${lightbox.css}`));
    // Script order as published: c-carousel.js, then c-lightbox.js (both deferred, in document order).
    await page.addScriptTag({ content: carousel.js });
    await page.addScriptTag({ content: lightbox.js });
    await page.waitForSelector('[data-sw-component="carousel"][data-sw-enhanced="true"]');
    await page.waitForSelector('[data-sw-component="lightbox"][data-sw-enhanced="true"]');

    await page.locator('[data-sw-part="slide"] a').first().click();
    await page.waitForSelector('.sw-lightbox[aria-hidden="false"]');
    // Below the carousel, so its pause-on-hover can't hold autoplay still once nothing covers it.
    await page.mouse.move(600, 750);

    // The carousel must really advance while the viewer is open — that is the trigger.
    const first = await liveText(page);
    await expect.poll(() => liveText(page), { timeout: 5000 }).not.toBe(first);
    const second = await liveText(page);
    await expect.poll(() => liveText(page), { timeout: 5000 }).not.toBe(second);
    await page.waitForTimeout(400); // past the watcher's 120 ms coalescing window

    expect(await viewer(page)).toEqual({ viewers: 1, open: 1, wrappers: 1, bodyOverflow: 'hidden' });

    await page.locator('.sw-lightbox-dismiss').click();
    await page.waitForSelector('.sw-lightbox[aria-hidden="true"]', { state: 'attached' });
    await expect.poll(async () => (await viewer(page)).bodyOverflow).toBe('');

    const before = await scrollY(page);
    await page.mouse.move(600, 600);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);

    // The gallery still opens after the carousel has moved on (its bindings survived). Dispatched, not
    // a pointer click: autoplay keeps translating the slides, so any given one may be out of view.
    await page.evaluate('window.scrollTo(0, 0)');
    await page.locator('[data-sw-part="slide"] a').nth(1).dispatchEvent('click');
    await page.waitForSelector('.sw-lightbox[aria-hidden="false"]');
    expect((await viewer(page)).wrappers).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });
});
