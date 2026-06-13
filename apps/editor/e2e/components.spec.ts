import { test, expect, type APIRequestContext } from '@playwright/test';
import { deflateSync } from 'node:zlib';

// Interactive components against a deployed instance: the Embla-powered Carousel and the
// SmartPhoto-powered Lightbox, exercised on a PUBLISHED static site exactly as a visitor
// (and the no-JS fallback) experiences it. The page is authored the way the catalog
// teaches an agent: declarative data-sw-component / data-sw-part / data-* markup only.

const stamp = Date.now();
const slug = `comp-${stamp}`;
const site = `/sites/${slug}/`;

// --- tiny PNG generator (solid color) — real images for slides + lightbox ----------------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function solidPng(r: number, g: number, b: number, w = 320, h = 200): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function uploadPng(ctx: APIRequestContext, base: string, name: string, rgb: [number, number, number]): Promise<string> {
  const res = await ctx.post(`${base}/media`, {
    multipart: { file: { name: `${name}.png`, mimeType: 'image/png', buffer: solidPng(...rgb) } },
  });
  expect(res.status(), `upload ${name}`).toBe(201);
  // Media uploads respond with { item: { url, ... } } — url is slug-keyed (/media/<slug>/<id>/<file>).
  const { item } = (await res.json()) as { item: { url: string } };
  expect(item.url, `upload ${name} url`).toBeTruthy();
  return item.url;
}

// One slide per color so the visible slide is identifiable by its <img> src.
let imgs: string[] = [];

test.beforeAll(async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL: baseURL! });
  expect((await ctx.post('/auth/register', { data: { email: `comp-${stamp}@e2e.test`, password: 'Pw-secret-1' } })).status()).toBe(201);
  const proj = await ctx.post('/projects', { data: { name: 'Components Site', slug } });
  expect(proj.status()).toBe(201);
  const base = `/projects/${((await proj.json()) as { project: { id: string } }).project.id}`;

  imgs = [
    await uploadPng(ctx, base, 'red', [220, 60, 60]),
    await uploadPng(ctx, base, 'green', [60, 180, 90]),
    await uploadPng(ctx, base, 'blue', [60, 90, 220]),
  ];
  const slidesImg = imgs
    .map((u, i) => `<figure data-sw-part="slide" class="relative"><img src="${u}" alt="img-${i}" class="w-full" /></figure>`)
    .join('');
  const arrows =
    '<button type="button" data-sw-part="prev" aria-label="Previous slide"><svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>' +
    '<button type="button" data-sw-part="next" aria-label="Next slide"><svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>';
  const lbItems = imgs
    .map((u, i) => `<a data-sw-part="item" href="${u}" data-caption="Caption ${i}"><img src="${u}" alt="thumb-${i}" /></a>`)
    .join('');

  const source = `<div class="mx-auto max-w-3xl space-y-16 p-8">
<section id="fade"><div class="relative" data-sw-component="carousel" data-sw-block="Carousel" aria-label="Fade slider">
  <div data-sw-part="track">${slidesImg}</div>${arrows}<div data-sw-part="dots" aria-hidden="true"></div>
</div></section>
<section id="slide"><div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" aria-label="Slide slider">
  <div data-sw-part="track">${slidesImg}</div>${arrows}<div data-sw-part="dots" aria-hidden="true"></div>
</div></section>
<section id="items"><div class="relative [--sw-items:2.5]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" aria-label="Cards">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-red-200">A</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-green-200">B</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-blue-200">C</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-amber-200">D</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-purple-200">E</div></figure>
  </div>${arrows}
</div></section>
<section id="itemalign"><div class="relative [--sw-items:3]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-item-align="end" aria-label="Underfull row">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-red-200">A</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-24 bg-green-200">B</div></figure>
  </div>
</div></section>
<section id="hero"><div class="relative h-72" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-kenburns aria-label="Hero">
  <div data-sw-part="track">
    <div data-sw-part="slide"><div class="sw-kenburns" style="background-color:#c00"></div><div class="sw-caption absolute inset-x-0 bottom-2 text-center text-white">One</div></div>
    <div data-sw-part="slide"><div class="sw-kenburns" style="background-color:#0c0"></div><div class="sw-caption absolute inset-x-0 bottom-2 text-center text-white">Two</div></div>
  </div>${arrows}<div data-sw-part="dots" aria-hidden="true"></div>
</div></section>
<section id="scroll"><div class="relative [--sw-items:2]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoscroll="true" data-autoscroll-speed="2" aria-label="Ticker">
  <div data-sw-part="track">
    <figure data-sw-part="slide" class="px-2"><div class="h-16 bg-red-100">1</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-16 bg-green-100">2</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-16 bg-blue-100">3</div></figure>
    <figure data-sw-part="slide" class="px-2"><div class="h-16 bg-amber-100">4</div></figure>
  </div>
</div></section>
<section id="wheel"><div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-wheel="true" data-autoheight="true" aria-label="Quotes">
  <div data-sw-part="track">
    <figure data-sw-part="slide"><div class="h-24 bg-red-50">short</div></figure>
    <figure data-sw-part="slide"><div class="h-64 bg-green-50">tall</div></figure>
    <figure data-sw-part="slide"><div class="h-40 bg-blue-50">medium</div></figure>
  </div>${arrows}<div data-sw-part="dots" aria-hidden="true"></div>
</div></section>
<section id="click"><div class="relative" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-click-next="true" aria-label="Click advance">
  <div data-sw-part="track">
    <figure data-sw-part="slide"><div class="h-24 bg-red-200">A</div></figure>
    <figure data-sw-part="slide"><div class="h-24 bg-green-200">B <a href="#lnk" class="underline">a link</a></div></figure>
    <figure data-sw-part="slide"><div class="h-24 bg-blue-200">C</div></figure>
  </div><div data-sw-part="dots" aria-hidden="true"></div>
</div></section>
<section id="lb"><div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="Gallery">
  <div data-sw-part="grid">${lbItems}</div>
</div></section>
<section id="lbfx"><div data-sw-component="lightbox" data-sw-block="Lightbox" data-thumbnails="false" data-arrows="false" aria-label="Gallery 2">
  <div data-sw-part="grid">${lbItems}</div>
</div></section>
<section id="lbsingle"><img data-sw-component="lightbox" data-thumbnails="false" src="${imgs[1]}" data-full="${imgs[0]}" data-caption="Solo" alt="solo" style="max-width:200px"></section>
<section id="lbbare"><div data-sw-component="lightbox" aria-label="Bare gallery"><img src="${imgs[0]}" data-caption="Bare 0"><img src="${imgs[1]}" data-caption="Bare 1"><img src="${imgs[2]}" data-caption="Bare 2"></div></section>
</div>`;

  expect(
    (await ctx.put(`${base}/content/page/home`, { data: { id: 'home', path: '', title: 'Components', source } })).status(),
  ).toBe(200);
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);
  await ctx.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(site);
});

test('defaults: fade effect with overlay arrows mid-left/right and bottom-center dots', async ({ page }, testInfo) => {
  const root = page.locator('#fade [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');

  // Fade: the engine crossfades per-slide opacity (the active slide is opaque, the rest
  // fully transparent and parked off-viewport — so x positions are NOT comparable here).
  const slides = root.locator('[data-sw-part="slide"]');
  await expect(slides.nth(0)).toHaveCSS('opacity', '1');
  await expect(slides.nth(1)).toHaveCSS('opacity', '0');

  // The runtime stamps data-active on the selected slide — the CSS hook for per-activation
  // effects (caption entrance, Ken Burns). It must move with the snap, not just exist.
  await expect(slides.nth(0)).toHaveAttribute('data-active', '');
  await expect(slides.nth(1)).not.toHaveAttribute('data-active', '');

  // Regression: the ACTIVE slide sits flush with the track in EVERY snap. UA defaults like
  // figure{margin:1em 40px} survive modern-normalize and used to offset slide 0 by its margin
  // while later snaps landed flush — the component CSS resets slide margins to prevent it.
  const track = root.locator('[data-sw-part="track"]');
  const flush = async (i: number) => {
    await expect
      .poll(
        async () => {
          const t = (await track.boundingBox())!;
          const s = (await slides.nth(i).boundingBox())!;
          return Math.max(Math.abs(s.x - t.x), Math.abs(s.y - t.y));
        },
        { message: `slide ${i} flush with track` },
      )
      .toBeLessThan(2);
  };
  await flush(0);

  // Arrows overlay mid-left / mid-right (the :where() defaults).
  const rootBox = (await root.boundingBox())!;
  const prev = root.locator('[data-sw-part="prev"]');
  const next = root.locator('[data-sw-part="next"]');
  await expect(prev).toBeVisible();
  const pBox = (await prev.boundingBox())!;
  const nBox = (await next.boundingBox())!;
  expect(pBox.x - rootBox.x).toBeLessThan(40); // left overlay
  expect(rootBox.x + rootBox.width - (nBox.x + nBox.width)).toBeLessThan(40); // right overlay
  const midY = rootBox.y + rootBox.height / 2;
  expect(Math.abs(pBox.y + pBox.height / 2 - midY)).toBeLessThan(8); // vertically centered

  // Dots: one per slide, overlaid centered at the bottom, generated with the Lucide circle.
  const dots = root.locator('[data-sw-part="dots"] button');
  await expect(dots).toHaveCount(3);
  expect(await root.locator('[data-sw-part="dots"] button svg circle').count()).toBe(3);
  const dBox = (await root.locator('[data-sw-part="dots"]').boundingBox())!;
  expect(Math.abs(dBox.x + dBox.width / 2 - (rootBox.x + rootBox.width / 2))).toBeLessThan(10);
  expect(rootBox.y + rootBox.height - (dBox.y + dBox.height)).toBeLessThan(30); // near the bottom edge
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');

  // Arrow + keyboard navigation move the active snap; prev is disabled at the start (no loop).
  await expect(prev).toBeDisabled();
  // Press the next arrow via raw mouse events: the down-stroke must spawn the default
  // ripple ("waves") inside the button; releasing completes the click → snap 1.
  // Raw mouse coords are viewport-relative and DON'T auto-scroll — bring it on screen first.
  await next.scrollIntoViewIfNeeded();
  const press = (await next.boundingBox())!;
  await page.mouse.move(press.x + press.width / 2, press.y + press.height / 2);
  await page.mouse.down();
  await expect(next.locator('.sw-ripple')).toHaveCount(1);
  await page.mouse.up();
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(slides.nth(1)).toHaveCSS('opacity', '1'); // fade settled — the plugin only positions a slide once it's opaque
  await expect(slides.nth(1)).toHaveAttribute('data-active', ''); // the marker moved with the snap
  await expect(slides.nth(0)).not.toHaveAttribute('data-active', '');
  await flush(1);
  await next.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dots.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(next).toBeDisabled(); // end reached, no loop
  await expect(prev).toBeFocused(); // focus handed off the now-disabled arrow, not dropped to <body>
  await page.keyboard.press('ArrowLeft');
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');

  await page.screenshot({ path: testInfo.outputPath('carousel-fade-defaults.png'), clip: rootBox });
});

test('slide effect translates the strip; data-loop wraps backwards from the first slide', async ({ page }) => {
  const root = page.locator('#slide [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');

  // Slide effect: slides sit side by side (different x), the container is translated.
  const slides = root.locator('[data-sw-part="slide"]');
  const b0 = (await slides.nth(0).boundingBox())!;
  const b1 = (await slides.nth(1).boundingBox())!;
  expect(b1.x - b0.x).toBeGreaterThan(100);

  const container = root.locator('[data-sw-part="container"]');
  const t0 = await container.evaluate((el) => getComputedStyle(el).transform);
  // Looping: prev from the first slide lands on the LAST dot.
  await root.locator('[data-sw-part="prev"]').click();
  const dots = root.locator('[data-sw-part="dots"] button');
  await expect(dots.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect
    .poll(async () => container.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(t0);
});

test('multi-item layout: --sw-items:2.5 sizes slides to 1/2.5 of the track (peek)', async ({ page }) => {
  const root = page.locator('#items [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const track = (await root.locator('[data-sw-part="track"]').boundingBox())!;
  const slide = (await root.locator('[data-sw-part="slide"]').first().boundingBox())!;
  expect(Math.abs(slide.width - track.width / 2.5)).toBeLessThan(2);
});

test('data-item-align distributes an underfull row horizontally (justify-content)', async ({ page }) => {
  // 2 slides in a --sw-items:3 track (each 1/3 wide) → the row is only 2/3 full, leaving
  // a third of the track empty. data-item-align="end" pushes both slides to the right edge.
  const root = page.locator('#itemalign [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const track = (await root.locator('[data-sw-part="track"]').boundingBox())!;
  const slides = root.locator('[data-sw-part="slide"]');
  const first = (await slides.nth(0).boundingBox())!;
  const last = (await slides.nth(1).boundingBox())!;
  // The pair is flush to the RIGHT edge: gap on the left ≈ track/3, ~none on the right.
  expect(first.x - track.x).toBeGreaterThan(track.width / 3 - 4);
  expect(track.x + track.width - (last.x + last.width)).toBeLessThan(4);
});

test('data-kenburns animates the active slide bg + caption (and only the active one)', async ({ page }) => {
  const root = page.locator('#hero [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const animName = (sel: string) =>
    root.locator(sel).evaluate((el) => getComputedStyle(el).animationName);
  // Active slide's background layer + caption are running a keyframe animation…
  await expect
    .poll(() => animName('[data-sw-part="slide"][data-active] .sw-kenburns'))
    .toMatch(/sw-kb-/);
  expect(await animName('[data-sw-part="slide"][data-active] .sw-caption')).toBe('sw-cap-in');
  // …the inactive slide is NOT animating (no data-active → no rule).
  expect(await animName('[data-sw-part="slide"]:not([data-active]) .sw-kenburns')).toBe('none');

  // Height streamlining: the root sets h-72 (288px) and the slides carry NO height class —
  // they fill the root height through track/container height:100% + align-items:stretch.
  const rootH = (await root.boundingBox())!.height;
  expect(Math.round(rootH)).toBe(288);
  const slideH = (await root.locator('[data-sw-part="slide"]').first().boundingBox())!.height;
  expect(Math.abs(slideH - rootH)).toBeLessThan(2);
});

test('auto-scroll ticks continuously and pauses on hover', async ({ page }) => {
  const root = page.locator('#scroll [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const container = root.locator('[data-sw-part="container"]');
  const sample = () => container.evaluate((el) => getComputedStyle(el).transform);
  const t0 = await sample();
  await expect.poll(sample, { timeout: 3000 }).not.toBe(t0); // moving on its own

  await root.hover();
  await page.waitForTimeout(400); // let the pause engage
  const p0 = await sample();
  await page.waitForTimeout(600);
  expect(await sample()).toBe(p0); // paused while hovered
});

test('wheel gestures navigate; auto height animates the track to the active slide', async ({ page }) => {
  const root = page.locator('#wheel [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const container = root.locator('[data-sw-part="container"]');
  const dots = root.locator('[data-sw-part="dots"] button');

  // Auto height: the container hugs the short first slide, not the tall second one.
  const h0 = (await container.boundingBox())!.height;
  expect(h0).toBeLessThan(150);

  // Regression: AutoHeight sizes the container to the slide's BORDER box, so any surviving
  // slide margin (UA figure default) pushed the slide past the track's overflow clip and cut
  // off its bottom edge. The active slide must be fully contained in the track.
  const tBox = (await root.locator('[data-sw-part="track"]').boundingBox())!;
  const sBox = (await root.locator('[data-sw-part="slide"]').first().boundingBox())!;
  expect(sBox.y + sBox.height).toBeLessThanOrEqual(tBox.y + tBox.height + 1);

  // Wheel gesture over the track → next slide.
  await root.locator('[data-sw-part="track"]').hover();
  for (let i = 0; i < 6; i++) await page.mouse.wheel(120, 0);
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');

  // The tall slide is now active — the container height animates up.
  await expect.poll(async () => (await container.boundingBox())!.height).toBeGreaterThan(h0 + 80);
});

test('click-to-slide: data-click-next advances on slide press with ripple; inner links keep their meaning', async ({ page }) => {
  const root = page.locator('#click [data-sw-block="Carousel"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  // With no focusable controls required, the root itself becomes keyboard-reachable.
  await expect(root).toHaveAttribute('tabindex', '0');
  const dots = root.locator('[data-sw-part="dots"] button');
  const track = root.locator('[data-sw-part="track"]');
  await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');

  // Press anywhere on the slide: the down-stroke ripples on the WRAPPER (a slide-hosted
  // ripple would translate away with the outgoing slide), the release advances.
  // (scroll first — raw mouse coords are viewport-relative and don't auto-scroll)
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(root.locator('.sw-ripple')).toHaveCount(1);
  await expect(root.locator('[data-sw-part="slide"] .sw-ripple')).toHaveCount(0); // NOT inside the moving slide
  // Wrapper-sized ripples are PACED to their size — a fixed duration would sweep the edge
  // across the slider ~45× faster than a button's halo. Controls keep ~0.65s.
  // dur > 1 requires the wrapper ≥ 525px wide (d > 1050); at this 1280px viewport the
  // carousel is ~1100px → d ≈ 2200 → dur 1.38s. Revisit if the fixture ever narrows.
  const dur = await root
    .locator('.sw-ripple')
    .evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(dur).toBeGreaterThan(1);
  await page.mouse.up();
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');

  // AT semantics: the runtime names the widget and announces the active slide politely.
  await expect(root).toHaveAttribute('role', 'region');
  await expect(root).toHaveAttribute('aria-roledescription', 'carousel');
  await expect(root.locator('.sw-sr-only')).toHaveText('Slide 2 of 3');

  // A link inside the (now active) slide keeps its own meaning — no advance on click.
  await root.locator('a[href="#lnk"]').click();
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');

  // A DRAG is not a click: pointer travel past the threshold never advances. Vertical drag
  // keeps this deterministic — Embla won't swipe on the cross axis either.
  const b2 = (await track.boundingBox())!;
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 + 40, { steps: 4 });
  await page.mouse.up();
  await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true'); // unchanged

  // Arrow keys work once the root has focus (tabindex stamped by the runtime).
  await root.focus();
  await page.keyboard.press('ArrowRight');
  await expect(dots.nth(2)).toHaveAttribute('aria-current', 'true');
});

test('lightbox: gallery viewer with thumbnail strip, counter, arrows, keyboard, and focus restore', async ({ page }, testInfo) => {
  const root = page.locator('#lb [data-sw-block="Lightbox"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const items = root.locator('[data-sw-part="item"]');
  // href ATTRIBUTE, not property: SmartPhoto sets the slide <img src> to a.getAttribute('href')
  // verbatim, so the shown src is the same (site-relative) string — the property would be absolute.
  const hrefs = await items.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));

  await items.first().click();
  const overlay = page.locator('.sw-lightbox');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'dialog');

  // The current slide shows the FULL image from the clicked anchor's own href; counter + caption track it.
  const shownSrc = () => overlay.locator('.sw-lightbox-list li.current img.sw-lightbox-img').first().getAttribute('src');
  await expect.poll(shownSrc).toBe(hrefs[0]);
  await expect(overlay.locator('.sw-lightbox-count')).toHaveText('1/3');
  await expect(overlay.locator('.sw-lightbox-caption')).toContainText('Caption 0');
  // The bottom thumbnail strip has one thumb per image; the open one is marked current.
  await expect(overlay.locator('.sw-lightbox-nav li')).toHaveCount(3);
  await expect(overlay.locator('.sw-lightbox-nav a.current')).toHaveCount(1);

  await page.waitForTimeout(600); // let the enlarge-from-thumbnail animation settle for the artifact
  await page.screenshot({ path: testInfo.outputPath('lightbox-open.png') });

  // Next arrow, then keyboard arrow; counter + image track the slides.
  await overlay.locator('.sw-lightbox-arrow-right a').click();
  await expect.poll(shownSrc).toBe(hrefs[1]);
  await expect(overlay.locator('.sw-lightbox-count')).toHaveText('2/3');
  await page.keyboard.press('ArrowRight');
  await expect.poll(shownSrc).toBe(hrefs[2]);
  await expect(overlay.locator('.sw-lightbox-count')).toHaveText('3/3');

  // No loop: at the last image SmartPhoto hides the next arrow (aria-hidden → display:none).
  await expect(overlay.locator('.sw-lightbox-arrow-right')).toBeHidden();

  // Escape closes (the overlay is hidden, not removed); focus returns to the triggering thumbnail.
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(items.first()).toBeFocused();
});

test('lightbox switches: data-thumbnails / data-arrows omit the strip and arrows', async ({ page }) => {
  const root = page.locator('#lbfx [data-sw-block="Lightbox"]');
  await expect(root).toHaveAttribute('data-sw-enhanced', 'true');
  const items = root.locator('[data-sw-part="item"]');

  await items.first().click();
  const overlay = page.locator('.sw-lightbox');
  await expect(overlay).toBeVisible();
  // The switches drop those parts from the runtime-built DOM entirely.
  await expect(overlay.locator('.sw-lightbox-nav')).toHaveCount(0);
  await expect(overlay.locator('.sw-lightbox-arrows')).toHaveCount(0);
  // The counter still tracks, and keyboard navigation still works without arrows.
  await expect(overlay.locator('.sw-lightbox-count')).toHaveText('1/3');
  await page.keyboard.press('ArrowRight');
  await expect(overlay.locator('.sw-lightbox-count')).toHaveText('2/3');
  await page.keyboard.press('Escape');
});

test('lightbox minimal forms: a bare <img> one-liner and a <div> of bare <img> become galleries', async ({ page }) => {
  // (1) One-line single image: the <img> IS the component. data-full is the full-size opened.
  const single = page.locator('#lbsingle img[data-sw-component="lightbox"]');
  await expect(single).toHaveAttribute('data-sw-enhanced', 'true');
  const full = (await single.getAttribute('data-full'))!;
  await single.click();
  const ov = page.locator('.sw-lightbox[aria-hidden="false"]');
  await expect(ov).toBeVisible();
  await expect(ov.locator('.sw-lightbox-count')).toHaveText('1/1');
  await expect(ov.locator('.sw-lightbox-list li.current img')).toHaveAttribute('src', full); // opened the data-full image
  await expect(ov.locator('.sw-lightbox-nav')).toHaveCount(0); // data-thumbnails="false"
  await page.keyboard.press('Escape');

  // (2) Minimal gallery: a <div data-sw-component="lightbox"> of bare <img> (auto-wrapped into items).
  const bare = page.locator('#lbbare [data-sw-component="lightbox"]');
  await expect(bare).toHaveAttribute('data-sw-enhanced', 'true');
  await bare.locator('img').first().click();
  const ov2 = page.locator('.sw-lightbox[aria-hidden="false"]');
  await expect(ov2).toBeVisible();
  await expect(ov2.locator('.sw-lightbox-count')).toHaveText('1/3');
  await expect(ov2.locator('.sw-lightbox-nav li')).toHaveCount(3);
  await expect(ov2.locator('.sw-lightbox-caption')).toContainText('Bare 0'); // data-caption copied onto the wrapped anchor
  await page.keyboard.press('Escape');
});

test('no-JS progressive enhancement: swipeable scroll-snap row, no inert controls, working image links', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(site);

  const root = page.locator('#slide [data-sw-block="Carousel"]');
  await expect(root).not.toHaveAttribute('data-sw-enhanced', 'true');
  // The track is a real scroller (content overflows horizontally) and controls stay hidden.
  const track = root.locator('[data-sw-part="track"]');
  expect(await track.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await track.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  await expect(root.locator('[data-sw-part="prev"]')).toBeHidden();
  await expect(root.locator('[data-sw-part="dots"]')).toBeHidden();

  // A lightbox item is a plain working link to the full image.
  const href = (await page.locator('#lb [data-sw-part="item"]').first().getAttribute('href'))!;
  await page.locator('#lb [data-sw-part="item"]').first().click();
  await page.waitForURL(`**${href}`);
  await ctx.close();
});
