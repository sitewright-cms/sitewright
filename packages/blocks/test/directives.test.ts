import { describe, it, expect } from 'vitest';
import { GLOBAL_TEMPLATES } from '@sitewright/core';
import { resolveDirectives } from '../src/directives.js';
import { renderTemplate, validateTemplate } from '../src/template.js';
import { buildSwImage, type SwImageOptions } from '../src/image-helper.js';
import type { RenderMedia } from '../src/folder.js';

describe('resolveDirectives — data-sw-text', () => {
  it('is a no-op when no directive is present (byte-identical)', () => {
    const html = '<div class="x"><h1>Hi &amp; bye</h1><img src="/a.jpg"></div>';
    expect(resolveDirectives(html, { preview: true })).toBe(html);
  });

  it('binds content to textContent, escaping any markup in the value', () => {
    const html = '<h1 data-sw-text="t">Welcome</h1>';
    const out = resolveDirectives(html, { data: { t: '<b>x</b> & <script>y' }, preview: true });
    expect(out).toContain('data-sw-text="t"');
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('&amp;');
  });

  it('keeps the authored default when the key is unset', () => {
    expect(resolveDirectives('<h1 data-sw-text="t">Default</h1>', { preview: true })).toBe(
      '<h1 data-sw-text="t">Default</h1>',
    );
  });

  it('keeps the marker in preview, strips it on publish', () => {
    const html = '<h1 data-sw-text="t">Welcome</h1>';
    expect(resolveDirectives(html, { data: { t: 'Hi' }, preview: true })).toBe('<h1 data-sw-text="t">Hi</h1>');
    expect(resolveDirectives(html, { data: { t: 'Hi' } })).toBe('<h1>Hi</h1>');
  });

  it('ignores prototype-pollution keys', () => {
    const html = '<h1 data-sw-text="__proto__">Default</h1>';
    const out = resolveDirectives(html, { data: { __proto__: 'evil' } as Record<string, string>, preview: true });
    expect(out).toContain('Default');
    expect(out).not.toContain('evil');
  });

  it('keeps the authored default when a bare key holds a non-string page.data value', () => {
    const out = resolveDirectives('<h1 data-sw-text="n">Def</h1>', { data: { n: 42 } as unknown as Record<string, string>, preview: true });
    expect(out).toContain('>Def<'); // a number leaf is not a text override
  });
});

describe('resolveDirectives — website.data.<path> (the site-wide store)', () => {
  it('resolves a website.data path for text and rich html — the store chrome slots can reach', () => {
    // A chrome slot is not a page, so before this the only editable leaf reachable from mainNav /
    // footer / bottom was data-sw-translate, which is PLAIN TEXT. One rich block therefore had to be
    // shredded into many translate keys. A website.data binding gives chrome ONE editable region.
    const html = '<div data-sw-html="website.data.job_modal">Authored</div>';
    const out = resolveDirectives(html, {
      websiteData: { job_modal: '<p>We are hiring a <strong>Podologist</strong>.</p>' },
      preview: true,
    });
    expect(out).toContain('<strong>Podologist</strong>');
    expect(out).not.toContain('Authored');
    // …and plain text through the same store
    expect(
      resolveDirectives('<h1 data-sw-text="website.data.tagline">Def</h1>', { websiteData: { tagline: 'Hi' }, preview: true }),
    ).toContain('>Hi<');
  });

  it('is a SEPARATE store from page.data — neither prefix can read the other', () => {
    const html = '<h1 data-sw-text="website.data.k">Authored</h1>';
    // page.data holding the same key must NOT satisfy a website.data binding…
    expect(resolveDirectives(html, { data: { k: 'from page' }, preview: true })).toContain('>Authored<');
    expect(resolveDirectives(html, { websiteData: { k: 'from site' }, preview: true })).toContain('>from site<');
    // …and the reverse: a page.data binding must not read the site store.
    const pageHtml = '<h1 data-sw-text="page.data.k">Authored</h1>';
    expect(resolveDirectives(pageHtml, { websiteData: { k: 'from site' }, preview: true })).toContain('>Authored<');
  });

  it('walks nested paths, keeps the default for a missing/non-string leaf, and is proto-guarded', () => {
    const ctx = { websiteData: { a: { b: { c: 'deep' } }, n: 42 }, preview: true } as const;
    expect(resolveDirectives('<p data-sw-text="website.data.a.b.c">D</p>', ctx)).toContain('>deep<');
    expect(resolveDirectives('<p data-sw-text="website.data.a.b.missing">D</p>', ctx)).toContain('>D<');
    expect(resolveDirectives('<p data-sw-text="website.data.n">D</p>', ctx)).toContain('>D<'); // non-string
    // A prototype-walking path must not resolve (own-property + DANGEROUS_KEYS guarded).
    const poisoned = JSON.parse('{"__proto__":{"pwned":"yes"}}') as Record<string, unknown>;
    expect(
      resolveDirectives('<p data-sw-text="website.data.__proto__.pwned">Safe</p>', { websiteData: poisoned, preview: true }),
    ).toContain('>Safe<');
    expect(
      resolveDirectives('<p data-sw-text="website.data.constructor.name">Safe</p>', { websiteData: {}, preview: true }),
    ).toContain('>Safe<');
  });

  it('sanitizes site-store HTML through the same sink and strips markers on publish', () => {
    const evil = { bio: '<img src=x onerror=alert(1)><script>bad()</script><em>ok</em>' };
    const out = resolveDirectives('<div data-sw-html="website.data.bio">D</div>', { websiteData: evil, preview: true });
    expect(out).toContain('<em>ok</em>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<script');
    // PUBLISH (no preview flag) strips the marker attribute, like every other directive.
    expect(resolveDirectives('<div data-sw-html="website.data.bio">D</div>', { websiteData: { bio: '<em>ok</em>' } })).toBe(
      '<div><em>ok</em></div>',
    );
  });
});

describe('resolveDirectives — data-sw-translate', () => {
  it('binds the per-locale catalog value to textContent, escaping markup', () => {
    const html = '<span data-sw-translate="nav_cta">Default</span>';
    const out = resolveDirectives(html, { t: { nav_cta: 'Projekt <b>starten</b> & los' }, preview: true });
    expect(out).toContain('data-sw-translate="nav_cta"');
    expect(out).toContain('Projekt &lt;b&gt;starten&lt;/b&gt; &amp; los');
    expect(out).not.toContain('<b>');
  });

  it('reads website.t — NOT page.data (the two stores are independent)', () => {
    const html = '<span data-sw-translate="k">Authored</span>';
    // a page.data["k"] must NOT bleed into a translate directive
    expect(resolveDirectives(html, { data: { k: 'from page.data' }, preview: true })).toContain('>Authored<');
    expect(resolveDirectives(html, { t: { k: 'from catalog' }, preview: true })).toContain('>from catalog<');
  });

  it('keeps the authored fallback when the key is untranslated (missing or empty)', () => {
    expect(resolveDirectives('<span data-sw-translate="k">Fallback</span>', { preview: true })).toContain('>Fallback<');
    // resolveTranslations omits empties, but a present-but-empty cell must not blank the element either
    expect(resolveDirectives('<span data-sw-translate="k">Fallback</span>', { t: { k: '' }, preview: true })).toContain('>Fallback<');
  });

  it('keeps the marker in preview, strips it on publish', () => {
    const html = '<span data-sw-translate="k">Def</span>';
    expect(resolveDirectives(html, { t: { k: 'Hi' }, preview: true })).toBe('<span data-sw-translate="k">Hi</span>');
    expect(resolveDirectives(html, { t: { k: 'Hi' } })).toBe('<span>Hi</span>');
  });

  it('ignores prototype-pollution keys', () => {
    const out = resolveDirectives('<span data-sw-translate="__proto__">Def</span>', {
      t: { __proto__: 'evil' } as Record<string, string>,
      preview: true,
    });
    expect(out).toContain('>Def<');
    expect(out).not.toContain('evil');
  });

  it('resolves end-to-end through renderTemplate from website.translations + page.locale', () => {
    const out = renderTemplate('<span data-sw-translate="hello">Hi</span>', {
      website: { t: { hello: 'Hola' } },
      preview: true,
    });
    expect(out).toContain('>Hola<');
  });

  it('passes validateTemplate (no JS) on a translate directive', () => {
    expect(() => validateTemplate('<span data-sw-translate="k">x</span>')).not.toThrow();
  });
});

describe('resolveDirectives — data-sw-html', () => {
  it('sets innerHTML from sanitized rich content in page.data (bare key)', () => {
    const html = '<div data-sw-html="body"><p>fallback</p></div>';
    const out = resolveDirectives(html, { data: { body: '<p>new <strong>copy</strong></p>' }, preview: true });
    expect(out).toContain('<p>new <strong>copy</strong></p>');
    expect(out).not.toContain('fallback');
  });

  it('reads a nested data.<path> rich leaf too', () => {
    const html = '<div data-sw-html="page.data.article.body"><p>fallback</p></div>';
    const out = resolveDirectives(html, { data: { article: { body: '<p>nested</p>' } }, preview: true });
    expect(out).toContain('<p>nested</p>');
    expect(out).not.toContain('fallback');
  });

  it('sanitizes the value (a script/onerror cannot survive)', () => {
    const html = '<div data-sw-html="body">x</div>';
    const out = resolveDirectives(html, {
      data: { body: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>' },
      preview: true,
    });
    expect(out).toContain('<p>ok</p>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('onerror');
  });

  it('strips the marker on publish', () => {
    const html = '<div data-sw-html="body"><p>d</p></div>';
    expect(resolveDirectives(html, { data: { body: '<p>v</p>' } })).toBe('<div><p>v</p></div>');
  });
});

describe('resolveDirectives — data-sw-href', () => {
  it('sets the anchor href from content, scheme-sanitized', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { data: { cta: 'https://x.test' }, preview: true })).toBe(
      '<a data-sw-href="cta" href="https://x.test">Go</a>',
    );
    expect(resolveDirectives(html, { data: { cta: 'javascript:alert(1)' }, preview: true })).toContain('href="#"');
  });

  it('keeps the authored href when unset; strips the marker on publish', () => {
    const html = '<a data-sw-href="cta" href="/old">Go</a>';
    expect(resolveDirectives(html, { preview: true })).toBe('<a data-sw-href="cta" href="/old">Go</a>');
    expect(resolveDirectives(html, { data: { cta: '/new' } })).toBe('<a href="/new">Go</a>');
  });
});

describe('resolveDirectives — data-sw-src / data-sw-bg (images)', () => {
  it('replaces an img src from content, scheme-sanitized; publish strips the marker', () => {
    const html = '<img data-sw-src="hero" src="/old.jpg" alt="">';
    const preview = resolveDirectives(html, { data: { hero: '/media/p/a/new.jpg' }, preview: true });
    expect(preview).toContain('data-sw-src="hero"');
    expect(preview).toContain('src="/media/p/a/new.jpg"');
    const published = resolveDirectives(html, { data: { hero: 'javascript:alert(1)' } });
    expect(published).not.toContain('data-sw-src');
    expect(published).not.toContain('javascript'); // neutralized to an empty src
  });

  it('an override with no rungs to rebuild DROPS the old image’s srcset/sizes, LQIP and <picture> sources', () => {
    // The bug this pins: {{sw-image editable="photo1"}} emits src + srcset + sizes + a blur-up LQIP.
    // The browser picks its candidate from srcset in PREFERENCE to src, so replacing only `src` left
    // the OLD photo on screen — clicking the image in the editor and choosing a new one did nothing.
    // (No media list here, so the new file's rungs are unknowable — the rebuild path is pinned below.)
    const emitted =
      '<img src="/media/p/a/old.jpg?size=lg" srcset="/media/p/a/old.jpg?size=sm 480w, /media/p/a/old.jpg?size=lg 1200w" ' +
      'sizes="100vw" alt="" width="1200" height="800" loading="lazy" decoding="async" data-sw-src="photo1" ' +
      'style="background-image:url(\'data:image/webp;base64,OLD\');background-size:cover">';
    const out = resolveDirectives(emitted, { data: { photo1: '/media/p/a/new.jpg' }, preview: true });
    expect(out).toContain('src="/media/p/a/new.jpg"');
    expect(out).not.toContain('old.jpg'); // no srcset, no LQIP — nothing left describing the old file
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('base64');
    expect(out).toContain('width="1200"'); // dimensions/alt/loading are the ELEMENT's, not the art's

    // format=avif wraps it in <picture>; a matching <source> outranks the <img> entirely.
    const pic =
      '<picture><source type="image/avif" srcset="/media/p/a/old.jpg?size=lg&format=avif 1200w" sizes="100vw">' +
      '<img src="/media/p/a/old.jpg?size=lg" alt="" data-sw-src="photo1"></picture>';
    const outPic = resolveDirectives(pic, { data: { photo1: '/media/p/a/new.jpg' }, preview: true });
    expect(outPic).not.toContain('<source');
    expect(outPic).toContain('src="/media/p/a/new.jpg"');

    // No override → the responsive markup is untouched (an unedited image keeps every rung).
    expect(resolveDirectives(emitted, { preview: true })).toContain('srcset=');
  });

  it('keeps unrelated style declarations when replacing a background — even across a data: URI', () => {
    // A `;` lives inside `url('data:image/webp;base64,…')`, so splitting the style attribute on bare
    // semicolons cuts the data URI in half and leaves its tail behind as garbage CSS.
    const out = resolveDirectives(
      '<section data-sw-bg="bg" style="padding:2rem;background-image:url(\'data:image/webp;base64,AAAA\');color:red">x</section>',
      { data: { bg: '/media/p/a/x.jpg' }, preview: true },
    );
    expect(out).toContain('padding:2rem');
    expect(out).toContain('color:red');
    expect(out).not.toContain('base64');
    expect(out).not.toContain('AAAA');
    expect(out).toContain('/media/p/a/x.jpg');
  });

  it('sets a CSS-guarded background-image, merging existing style; refuses a breakout URL', () => {
    // (the url() delimiter single-quotes appear LITERALLY in the double-quoted style attribute —
    //  escapeAttribute only escapes " and &, not ' — so the assertions avoid the quote char.)
    const out = resolveDirectives('<section data-sw-bg="bg" style="padding:2rem">x</section>', {
      data: { bg: '/media/p/a/x.jpg' },
      preview: true,
    });
    expect(out).toContain('background-image:url(');
    expect(out).toContain('/media/p/a/x.jpg');
    expect(out).toContain('padding:2rem');
    expect(out).toContain('data-sw-bg="bg"');

    const evil = resolveDirectives('<section data-sw-bg="bg">x</section>', {
      data: { bg: "/x');background:red" },
      preview: true,
    });
    expect(evil).not.toContain('background-image'); // url with ' and ( ) refused

    const published = resolveDirectives('<section data-sw-bg="bg">x</section>', { data: { bg: '/media/a.jpg' } });
    expect(published).toContain('background-image:url(');
    expect(published).toContain('/media/a.jpg');
    expect(published).not.toContain('data-sw-bg');
  });

  it('accepts a DIRECT URL value (a resolved dataset field), not only a page.data key', () => {
    // A {{#each}} dataset loop renders data-sw-bg/data-sw-src to a real URL (the validator forbids
    // interpolating into `style`, so a per-item background must ride a directive). No page.data needed.
    const bg = resolveDirectives('<a data-sw-bg="/media/agri.jpg">x</a>', {});
    expect(bg).toContain("background-image:url('/media/agri.jpg')");
    const src = resolveDirectives('<img data-sw-src="/media/tile.jpg" src="" alt="">', {});
    expect(src).toContain('src="/media/tile.jpg"');
    // A bare non-URL key with no page.data override stays the authored default (no breakout).
    expect(resolveDirectives('<a data-sw-bg="image">x</a>', {})).not.toContain('background-image');
  });

  it('LAZY: data-sw-src fills data-src (not src) when the element opts into lazy-loading', () => {
    // The author marks the image lazy by adding a (possibly empty) data-src; the runtime swaps it in.
    const out = resolveDirectives('<img data-sw-src="hero" data-src alt="">', { data: { hero: '/media/p/a/new.jpg' } });
    expect(out).toContain('data-src="/media/p/a/new.jpg"');
    expect(out).not.toMatch(/\ssrc="/); // eager src is NOT set
    expect(out).not.toContain('data-sw-src'); // publish strips the directive marker, keeps data-src
  });

  it('LAZY: data-sw-bg fills data-bg (not inline style) when the element opts into lazy-loading', () => {
    const out = resolveDirectives('<section data-sw-bg="bg" data-bg>x</section>', { data: { bg: '/media/p/a/x.jpg' } });
    expect(out).toContain('data-bg="/media/p/a/x.jpg"');
    expect(out).not.toContain('background-image'); // no eager inline style — the runtime sets it on intersect
    expect(out).not.toContain('data-sw-bg');
  });

  it('non-lazy elements are unchanged (src / inline style as before)', () => {
    expect(resolveDirectives('<img data-sw-src="h">', { data: { h: '/m/a.jpg' } })).toContain('src="/m/a.jpg"');
    expect(resolveDirectives('<section data-sw-bg="b">x</section>', { data: { b: '/m/a.jpg' } })).toContain('background-image:url(');
  });

  it('LAZY paths still scheme-sanitize via safeUrl (no javascript:/data: in data-src/data-bg)', () => {
    const src = resolveDirectives('<img data-sw-src="h" data-src>', { data: { h: 'javascript:alert(1)' } });
    expect(src).not.toContain('javascript'); // neutralized to data-src=""
    const bg = resolveDirectives('<section data-sw-bg="b" data-bg>x</section>', { data: { b: 'javascript:alert(1)' } });
    expect(bg).not.toContain('javascript'); // rejected → authored data-bg kept, no bad URL
  });

  it('lazy authoring markup passes the no-JS template validator', () => {
    // A valueless / empty data-src|data-bg is the lazy opt-in marker (no interpolation → safe).
    expect(() => validateTemplate('<img data-sw-src="hero" data-src src="/placeholder.jpg" alt="">')).not.toThrow();
    expect(() => validateTemplate('<section data-sw-bg="bg" data-bg>x</section>')).not.toThrow();
  });
});

describe('resolveDirectives — a replaced PROJECT image stays responsive (data-sw-src + media)', () => {
  // The bug this pins: replacing an editable {{sw-image}} in the editor stored the bare asset url, and
  // the directive could only DROP the old art — so the new photo shipped as one `size=xl` (2400px) file
  // to every device, still carrying the OLD photo's width/height (wrong aspect → layout shift). The
  // render context knows every project image's intrinsic size, so the art is rebuilt for the new file.
  const oldImg: RenderMedia = {
    id: 'a1', folder: '', kind: 'image', filename: 'old.jpg', url: '/media/acme/a1-old.jpg',
    width: 1200, height: 800, placeholder: 'data:image/webp;base64,OLD',
  };
  const newImg: RenderMedia = {
    id: 'b2', folder: '', kind: 'image', filename: 'new.jpg', url: '/media/acme/b2-new.jpg',
    width: 3000, height: 1000, placeholder: 'data:image/webp;base64,NEW',
  };
  const smallImg: RenderMedia = {
    id: 'c3', folder: '', kind: 'image', filename: 'small.png', url: '/media/acme/c3-small.png', width: 700, height: 700,
  };
  const alphaImg: RenderMedia = { ...newImg, id: 'd4', filename: 'cutout.png', url: '/media/acme/d4-cutout.png', hasAlpha: true };
  const svgImg: RenderMedia = { id: 'e5', folder: '', kind: 'image', filename: 'mark.svg', url: '/media/acme/e5-mark.svg', width: 64, height: 64 };
  const dimless: RenderMedia = { id: 'f6', folder: '', kind: 'image', filename: 'odd.jpg', url: '/media/acme/f6-odd.jpg' };
  const media = [oldImg, newImg, smallImg, alphaImg, svgImg, dimless];
  const opts: SwImageOptions = { editable: 'hero', alt: 'Our team', sizes: '(min-width:768px) 50vw, 100vw', className: 'rounded-xl', loading: 'eager' };

  /** {{sw-image}} of `url` as the author wrote it, through the directive pass with the hero override `value`. */
  const replaced = (value: string, o: SwImageOptions = opts, preview = true): string =>
    resolveDirectives(buildSwImage(oldImg.url, media, o), { data: { hero: value }, media, preview });
  /** A FRESH {{sw-image}} of `url` through the same pass with no override — the reference shape. */
  const fresh = (url: string, o: SwImageOptions = opts, preview = true): string =>
    resolveDirectives(buildSwImage(url, media, o), { media, preview });

  it('rebuilds the srcset, dimensions and LQIP for the NEW asset — byte-identical to a fresh {{sw-image}} of it', () => {
    const out = replaced(newImg.url);
    expect(out).toBe(fresh(newImg.url));
    // …spelled out: every rung of the 3000px replacement, capped at xl (2400 — the delivery cap).
    expect(out).toContain(
      'srcset="/media/acme/b2-new.jpg?size=sm 500w, /media/acme/b2-new.jpg?size=md 1000w, ' +
        '/media/acme/b2-new.jpg?size=lg 1600w, /media/acme/b2-new.jpg?size=xl 2400w"',
    );
    expect(out).toContain('src="/media/acme/b2-new.jpg?size=xl"');
    expect(out).toContain('width="3000" height="1000"'); // the NEW aspect, not the old 1200×800
    expect(out).toContain("background-image:url('data:image/webp;base64,NEW')");
    // The author's own attributes survive: sizes, alt, class, loading, fetchpriority.
    expect(out).toContain('sizes="(min-width:768px) 50vw, 100vw"');
    expect(out).toContain('alt="Our team"');
    expect(out).toContain('class="rounded-xl"');
    expect(out).toContain('loading="eager"');
    expect(out).toContain('fetchpriority="high"');
    // Nothing describing the old file is left behind.
    expect(out).not.toContain('a1-old');
    expect(out).not.toContain('OLD');
  });

  it('never upscales: a small replacement gets only the rungs it can fill, the top one clamped', () => {
    const out = replaced(smallImg.url);
    expect(out).toBe(fresh(smallImg.url));
    expect(out).toContain('srcset="/media/acme/c3-small.png?size=sm 500w, /media/acme/c3-small.png?size=md 700w"');
    expect(out).toContain('src="/media/acme/c3-small.png?size=md"');
    expect(out).not.toContain('size=lg');
    expect(out).toContain('width="700" height="700"');
    // No placeholder recorded for the replacement → the OLD one must not linger behind it.
    expect(out).not.toContain('background-image');
  });

  it('drops the blur-up for transparent art but keeps the author’s other style declarations', () => {
    const handWritten =
      '<img data-sw-src="hero" src="/media/acme/a1-old.jpg?size=lg" srcset="/media/acme/a1-old.jpg?size=sm 500w" sizes="50vw" ' +
      'width="1200" height="800" alt="" style="border-radius:8px;background-image:url(\'data:image/webp;base64,OLD\');background-size:cover">';
    const out = resolveDirectives(handWritten, { data: { hero: alphaImg.url }, media });
    expect(out).toContain('style="border-radius:8px"');
    expect(out).not.toContain('base64');
    expect(out).toContain('srcset="/media/acme/d4-cutout.png?size=sm 500w,');
    expect(out).toContain('width="3000" height="1000"');
  });

  it('rebuilds a <picture>’s AVIF + WebP sources for the new asset (format=avif)', () => {
    const avif: SwImageOptions = { ...opts, format: 'avif' };
    const out = replaced(newImg.url, avif);
    expect(out).toBe(fresh(newImg.url, avif));
    expect(out).toContain('<source type="image/avif" srcset="/media/acme/b2-new.jpg?size=sm&amp;format=avif 500w,');
    expect(out).toContain('<source type="image/webp" srcset="/media/acme/b2-new.jpg?size=sm 500w,');
    expect(out).toContain('sizes="(min-width:768px) 50vw, 100vw"'); // each source keeps its sizes
    expect(out).not.toContain('a1-old');
  });

  it('removes a <source> it cannot rebuild (no known type, or art-directed by media=)', () => {
    const pic =
      '<picture><source type="image/avif" srcset="/media/acme/a1-old.jpg?size=sm&format=avif 500w">' +
      '<source media="(max-width:600px)" type="image/webp" srcset="/media/acme/a1-old.jpg?size=sm 500w">' +
      '<source type="image/jpeg" srcset="/media/acme/a1-old.jpg 1200w">' +
      '<img src="/media/acme/a1-old.jpg?size=lg" alt="" width="1200" height="800" data-sw-src="hero"></picture>';
    const out = resolveDirectives(pic, { data: { hero: newImg.url }, media });
    expect(out.match(/<source/g)).toHaveLength(1);
    expect(out).toContain('<source type="image/avif" srcset="/media/acme/b2-new.jpg?size=sm&amp;format=avif 500w,');
    expect(out).not.toContain('a1-old');
  });

  it('points a lightbox item’s full-size link at the NEW asset too', () => {
    const lb: SwImageOptions = { ...opts, lightbox: true };
    const out = replaced(newImg.url, lb);
    expect(out).toBe(fresh(newImg.url, lb));
    expect(out).toContain('<a href="/media/acme/b2-new.jpg?size=xl" data-full="/media/acme/b2-new.jpg?size=xl"');
    // …but an anchor the author pointed somewhere else is theirs, not the image's.
    const own = resolveDirectives(
      '<a href="/about/"><img data-sw-src="hero" src="/media/acme/a1-old.jpg?size=lg" srcset="/media/acme/a1-old.jpg?size=sm 500w" alt=""></a>',
      { data: { hero: newImg.url }, media },
    );
    expect(own).toContain('<a href="/about/">');
  });

  it('PUBLISH: the rebuilt art ships with the directive marker stripped', () => {
    const out = replaced(newImg.url, opts, false);
    expect(out).toBe(fresh(newImg.url, opts, false));
    expect(out).not.toContain('data-sw-src');
    expect(out).toContain('/media/acme/b2-new.jpg?size=xl 2400w');
  });

  it.each([
    ['an external url', 'https://cdn.example/photo.jpg'],
    ['an SVG project image (a vector has no ?size= rungs)', svgImg.url],
    ['a project image with no recorded dimensions', dimless.url],
    ['an unknown asset id', '/media/acme/zz-gone.jpg'],
    ['a url that already carries a query', `${newImg.url}?size=md`],
  ])('falls back to the plain swap for %s: old art dropped, element dims untouched', (_label, value) => {
    const out = replaced(value);
    expect(out).toContain(`src="${value.replace(/&/g, '&amp;')}"`);
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('base64');
    expect(out).toContain('width="1200" height="800"'); // today's behaviour, exactly
  });

  it.each([
    // The id resolver reads `b2` out of every one of these, so each reaches a REAL raster record.
    ['a space + extra candidate', '/media/acme/b2/x.png 1w, https://evil.example/p.png'],
    ['a bare comma + extra candidate', '/media/acme/b2/x.png,https://evil.example/p.png'],
    ['a trailing descriptor', '/media/acme/b2-new.jpg 2x'],
    ['an empty segment (//)', '/media/acme/b2//new.jpg'],
    ['extra segments', '/media/acme/b2/sub/dir/new.jpg'],
  ])('never rebuilds rungs around an editor-supplied url with %s — no smuggled srcset candidate', (_label, value) => {
    const out = replaced(value);
    // The plain swap: the whole value is ONE src (as before this feature), never concatenated into rungs.
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('?size=');
    expect(out).toContain('width="1200" height="800"');
  });

  it('builds the rungs from the RECORD’s url, not the override string', () => {
    // Same asset (id b2) spelled two other valid ways: the legacy folder shape, and a stale file name.
    for (const value of ['/media/acme/b2/new.jpg', '/media/acme/b2-renamed.jpg']) {
      const out = replaced(value);
      expect(out).toBe(fresh(newImg.url));
      expect(out).not.toContain(value);
    }
  });

  it('a raster replacement of an image that rendered PLAIN (an SVG default) stays a bare src', () => {
    // {{sw-image}} of an SVG emits no srcset, so there is nothing "responsive" to keep: the replacement
    // ships as the one bare url — the delivery default `xl` — exactly as before. Documented, not rebuilt.
    const authored = buildSwImage(svgImg.url, media, opts);
    const out = resolveDirectives(authored, { data: { hero: newImg.url }, media, preview: true });
    expect(out).toContain('src="/media/acme/b2-new.jpg"');
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('?size=');
    expect(out).toContain('width="64" height="64"'); // the element's own dims, untouched (today's swap)
  });

  it('falls back to the plain swap when the render context carries no media list', () => {
    const out = resolveDirectives(buildSwImage(oldImg.url, media, opts), { data: { hero: newImg.url }, preview: true });
    expect(out).toContain('src="/media/acme/b2-new.jpg"');
    expect(out).not.toContain('srcset');
  });

  it('leaves a PLAIN <img data-sw-src> plain — it never opted into rungs', () => {
    const out = resolveDirectives('<img data-sw-src="hero" src="/media/acme/a1-old.jpg" width="300" height="200" alt="Team">', {
      data: { hero: newImg.url },
      media,
    });
    expect(out).toBe('<img src="/media/acme/b2-new.jpg" width="300" height="200" alt="Team">');
  });

  it('an EMPTY override keeps the authored default — old srcset and all', () => {
    const authored = buildSwImage(oldImg.url, media, opts);
    const out = resolveDirectives(authored, { data: { hero: '' }, media, preview: true });
    expect(out).toBe(fresh(oldImg.url));
    expect(out).toContain('/media/acme/a1-old.jpg?size=sm 500w');
  });

  describe('LAZY (data-src) — rebuilt in the vocabulary the lazyload runtime swaps in, nothing eager', () => {
    const lazy =
      '<img data-sw-src="hero" data-src="/media/acme/a1-old.jpg?size=xl" data-srcset="/media/acme/a1-old.jpg?size=sm 500w, /media/acme/a1-old.jpg?size=lg 1200w" ' +
      'sizes="50vw" width="1200" height="800" alt="Team">';

    it('fills data-src + data-srcset for the new asset and never adds an eager src/srcset', () => {
      const out = resolveDirectives(lazy, { data: { hero: newImg.url }, media });
      expect(out).toContain('data-src="/media/acme/b2-new.jpg?size=xl"');
      expect(out).toContain('data-srcset="/media/acme/b2-new.jpg?size=sm 500w, /media/acme/b2-new.jpg?size=md 1000w,');
      expect(out).not.toMatch(/\ssrc="/);
      expect(out).not.toMatch(/\ssrcset="/);
      expect(out).toContain('sizes="50vw"');
      expect(out).toContain('width="3000" height="1000"');
      expect(out).not.toContain('a1-old');
    });

    it('moves an eager srcset on a lazy image into data-srcset (an eager one would fetch at load)', () => {
      const out = resolveDirectives(
        '<img data-sw-src="hero" data-src srcset="/media/acme/a1-old.jpg?size=sm 500w" alt="">',
        { data: { hero: newImg.url }, media },
      );
      expect(out).toContain('data-srcset="/media/acme/b2-new.jpg?size=sm 500w,');
      expect(out).not.toMatch(/\ssrcset="/);
    });

    it('drops a lazy <picture>’s sources — the runtime cannot defer a <source>, and an eager one loads at once', () => {
      const out = resolveDirectives(
        '<picture><source type="image/avif" srcset="/media/acme/a1-old.jpg?size=sm&format=avif 500w">' +
          '<img data-sw-src="hero" data-src data-srcset="/media/acme/a1-old.jpg?size=sm 500w" alt=""></picture>',
        { data: { hero: newImg.url }, media },
      );
      expect(out).not.toContain('<source');
      expect(out).toContain('data-srcset="/media/acme/b2-new.jpg?size=sm 500w,');
    });

    it('an UNKNOWN replacement drops the old data-srcset too (the runtime would swap the OLD set in)', () => {
      const out = resolveDirectives(lazy, { data: { hero: 'https://cdn.example/x.jpg' }, media });
      expect(out).toContain('data-src="https://cdn.example/x.jpg"');
      expect(out).not.toContain('srcset');
      expect(out).not.toContain('a1-old');
    });
  });

  it('is wired through renderTemplate: the page render hands the project media to the directive pass', () => {
    const out = renderTemplate('{{sw-image "/media/acme/a1-old.jpg" editable="hero" sizes="50vw"}}', {
      page: { data: { hero: newImg.url } },
      media,
    });
    expect(out).toContain('/media/acme/b2-new.jpg?size=xl 2400w');
    expect(out).toContain('width="3000" height="1000"');
    expect(out).not.toContain('a1-old');
  });
});

describe('resolveDirectives — preview forces lazy images eager (editor must show content)', () => {
  // In the editor iframe native loading="lazy" is unreliable + arrives after Embla measures → blank
  // sliders. Preview render flips them eager; publish keeps lazy.
  it('PREVIEW: loading="lazy" → eager (even on a page whose only marker is the lazy img)', () => {
    const out = resolveDirectives('<div data-sw-entry="x" data-sw-dataset="d"><img src="/a.jpg" loading="lazy"></div>', { preview: true });
    expect(out).toContain('loading="eager"');
    expect(out).not.toContain('loading="lazy"');
  });
  it('PREVIEW: processes a no-directive page that only has lazy images', () => {
    const out = resolveDirectives('<section><img src="/a.jpg" loading="lazy"><img src="/b.jpg" loading="lazy"></section>', { preview: true });
    expect((out.match(/loading="eager"/g) ?? []).length).toBe(2);
  });
  it('PUBLISH: lazy is preserved (performance)', () => {
    const out = resolveDirectives('<div data-sw-text="t">x</div><img src="/a.jpg" loading="lazy">', { data: { t: 'hi' } });
    expect(out).toContain('loading="lazy"');
  });
  it('a non-directive, non-lazy page is still a byte-identical no-op', () => {
    const html = '<section><img src="/a.jpg"><p>hi</p></section>';
    expect(resolveDirectives(html, { preview: true })).toBe(html);
  });
  it('does NOT parse a page that only MENTIONS loading="lazy" in a code sample (no <img>)', () => {
    const html = '<pre><code>&lt;img loading="lazy"&gt;</code></pre>';
    expect(resolveDirectives(html, { preview: true })).toBe(html); // byte-identical no-op
  });
});

describe('resolveDirectives — empty URL override reverts to the authored default', () => {
  it('keeps the default src/href/bg when the stored value is empty (clear = revert)', () => {
    expect(resolveDirectives('<img data-sw-src="hero" src="/default.jpg">', { data: { hero: '' }, preview: true })).toContain(
      'src="/default.jpg"',
    );
    expect(resolveDirectives('<a data-sw-href="c" href="/keep">x</a>', { data: { c: '' }, preview: true })).toContain(
      'href="/keep"',
    );
    const bg = resolveDirectives('<section data-sw-bg="b" style="background-image:url(/d.jpg)">x</section>', {
      data: { b: '' },
      preview: true,
    });
    expect(bg).toContain('/d.jpg'); // the authored default background is preserved, not cleared
  });
});

describe('renderTemplate — directive integration', () => {
  it('resolves data-sw-html in preview (marker kept) and publish (stripped)', () => {
    const source = '<section data-sw-html="intro"><p>fallback</p></section>';
    const page = { data: { intro: '<p>Hello <em>world</em></p>' } };
    const preview = renderTemplate(source, { page, preview: true });
    expect(preview).toContain('data-sw-html="intro"');
    expect(preview).toContain('<p>Hello <em>world</em></p>');

    const published = renderTemplate(source, { page });
    expect(published).not.toContain('data-sw-html');
    expect(published).toContain('<p>Hello <em>world</em></p>');
  });

  it('composes with Handlebars loops — directive markers are page-level, values are dataset-bound', () => {
    const source =
      '<h1 data-sw-text="title">Title</h1><ul>{{#each dataset.items}}<li>{{this.name}}</li>{{/each}}</ul>';
    const out = renderTemplate(source, {
      page: { data: { title: 'Our work' } }, // the directive's bare key reads page.data
      dataset: { items: [{ name: 'A' }, { name: 'B' }] }, // the dataset context for {{#each dataset.items}}
      preview: true,
    });
    expect(out).toContain('<h1 data-sw-text="title">Our work</h1>');
    expect(out).toContain('<li>A</li><li>B</li>');
  });
});

describe('resolveDirectives — data.<path> keys bind to page.data', () => {
  const data = {
    article_title: 'Hello <b>World</b>',
    article_body: '<p>Body</p><script>bad()</script>',
    article_image: '/a.jpg',
    nested: { deep: 'X' },
  };

  it('reads a STRING leaf for text (escaped), html (sanitized), and src', () => {
    const out = resolveDirectives(
      '<h1 data-sw-text="page.data.article_title">d</h1><div data-sw-html="page.data.article_body">d</div><img data-sw-src="page.data.article_image">',
      { data, preview: true },
    );
    expect(out).toContain('Hello &lt;b&gt;World&lt;/b&gt;'); // text escaped, no markup injected
    expect(out).toContain('<p>Body</p>'); // rich sanitized
    expect(out).not.toContain('<script>'); // script stripped
    expect(out).toContain('src="/a.jpg"');
  });

  it('resolves a deep dotted path', () => {
    expect(resolveDirectives('<span data-sw-text="page.data.nested.deep">d</span>', { data, preview: true })).toContain('>X<');
  });

  it('keeps the authored default for a missing path or a non-string leaf', () => {
    expect(resolveDirectives('<h1 data-sw-text="page.data.nope">Def</h1>', { data, preview: true })).toContain('>Def<');
    // `nested` is an object, not a string → no override
    expect(resolveDirectives('<h1 data-sw-text="page.data.nested">Def</h1>', { data, preview: true })).toContain('>Def<');
  });

  it('refuses a prototype-pollution segment (keeps the default)', () => {
    expect(resolveDirectives('<h1 data-sw-text="page.data.__proto__">Def</h1>', { data, preview: true })).toContain('>Def<');
    expect(resolveDirectives('<h1 data-sw-text="page.data.a.constructor">Def</h1>', { data, preview: true })).toContain('>Def<');
  });

  it('does not traverse array-index segments (symmetric with the editor)', () => {
    const d = { items: ['first', 'second'] };
    expect(resolveDirectives('<h1 data-sw-text="page.data.items.0">Def</h1>', { data: d, preview: true })).toContain('>Def<');
  });

  it('strips the markers on publish (no preview flag)', () => {
    const out = resolveDirectives('<h1 data-sw-text="page.data.article_title">d</h1>', { data });
    expect(out).toBe('<h1>Hello &lt;b&gt;World&lt;/b&gt;</h1>');
  });

  it('resolves through renderTemplate via page.data (preview + publish)', () => {
    const page = { data: { headline: 'Live' } };
    expect(renderTemplate('<h1 data-sw-text="page.data.headline">d</h1>', { page, preview: true })).toContain('data-sw-text="page.data.headline">Live<');
    expect(renderTemplate('<h1 data-sw-text="page.data.headline">d</h1>', { page })).toBe('<h1>Live</h1>');
  });
});

describe('global blog templates (content-only) render via validateTemplate', () => {
  const article = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-article')!;
  const overview = GLOBAL_TEMPLATES.find((t) => t.id === 'global:blog-overview')!;

  it('blog-article renders its declared page.data through the data-sw-* leaves (no validate throw)', () => {
    const page = { data: article.data };
    const out = renderTemplate(article.source, { page, preview: true });
    expect(out).toContain('Your article title'); // data.article_title via data-sw-text
    expect(() => renderTemplate(article.source, { page })).not.toThrow(); // publish path validates + renders
  });

  it('blog-overview lists children, reading each child’s page.data (image + excerpt)', () => {
    const page = {
      data: overview.data,
      children: [{ title: 'First', path: '/blog/first', data: { article_image: '/i.jpg', article_excerpt: 'Excerpt one' } }],
    };
    const out = renderTemplate(overview.source, { page });
    expect(out).toContain('href="/blog/first"'); // {{sw-url path}}
    expect(out).toContain('src="/i.jpg"'); // child's data.article_image
    expect(out).toContain('Excerpt one'); // child's data.article_excerpt
  });
});
