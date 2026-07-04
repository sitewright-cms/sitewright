import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { parse } from '../src/dom.js';
import { transformBody, type TransformCtx } from '../src/transform/page.js';
import { DEFAULT_LIMITS } from '../src/limits.js';

const ctx: TransformCtx = {
  pageUrl: 'https://ex.com/about',
  siteBase: 'https://ex.com/',
  internalRoutes: new Map([['https://ex.com/contact', '/contact']]),
  assetMap: new Map([['https://ex.com/logo.png', '/media/p/a/logo.jpg']]),
  limits: DEFAULT_LIMITS,
};

function run(bodyHtml: string) {
  return transformBody(parse(`<html><body>${bodyHtml}</body></html>`), ctx);
}

describe('transformBody', () => {
  it('pretty-prints the source (block elements indented on their own lines; inline kept compact)', () => {
    const { source } = run('<section class="s"><div class="row"><p>Hello <a href="/x">link</a> world</p></div></section>');
    expect(source).toMatch(/\n/); // multi-line, not a single minified blob
    expect(source).toMatch(/\n {2}<div class="row">/); // nested block indented
    expect(source).toContain('<p>Hello <a href="/x">link</a> world</p>'); // inline run stays on one line
    expect(() => validateTemplate(source)).not.toThrow();
  });

  it('rewrites a self-hosted document <a href> to its /media file', () => {
    const docCtx: TransformCtx = { ...ctx, assetMap: new Map([['https://ex.com/brochure.pdf', '/media/p/a/file/brochure.pdf']]) };
    const { source } = transformBody(parse('<html><body><a href="/brochure.pdf">Download</a></body></html>'), docCtx);
    expect(source).toContain('href="/media/p/a/file/brochure.pdf"');
  });

  it('attaches a responsive WebP srcset to a self-hosted <img> (src stays the fallback)', () => {
    const ctxWithSrcset: TransformCtx = { ...ctx, srcsetMap: new Map([['https://ex.com/logo.png', '/media/p/a/logo-400.webp 400w, /media/p/a/logo-800.webp 800w']]) };
    const { source } = transformBody(parse('<html><body><img src="/logo.png" alt="logo"></body></html>'), ctxWithSrcset);
    expect(source).toContain('src="/media/p/a/logo.jpg"'); // fallback for legacy browsers
    expect(source).toContain('srcset="/media/p/a/logo-400.webp 400w, /media/p/a/logo-800.webp 800w"');
    expect(source).toMatch(/loading="lazy"/);
    expect(() => validateTemplate(source)).not.toThrow();
  });

  it('promotes lazy-loaded images (data-src) to a real, self-hosted src and drops the lazy attrs', () => {
    const { source } = run('<img src="data:image/gif;base64,placeholder" data-src="/logo.png" alt="logo" loading="lazy">');
    expect(source).toContain('src="/media/p/a/logo.jpg"'); // data-src promoted + self-hosted
    expect(source).not.toContain('data-src'); // lazy attr removed
    expect(source).not.toContain('data:image/gif'); // placeholder replaced
  });

  it('preserves allowlisted embeds (lazy map, YouTube, Facebook page) and drops non-allowlisted iframes', () => {
    const map = run('<iframe data-src="https://www.google.com/maps/embed?pb=1" title="map"></iframe>').source;
    expect(map).toContain('src="https://www.google.com/maps/embed?pb=1"'); // lazy data-src promoted + kept
    expect(map).toContain('loading="lazy"');
    expect(map).toContain('allowfullscreen');
    const yt = run('<iframe src="https://www.youtube.com/embed/abc"></iframe>').source;
    expect(yt).toContain('https://www.youtube.com/embed/abc');
    const fb = run('<iframe src="https://www.facebook.com/plugins/page.php?href=acme"></iframe>').source;
    expect(fb).toContain('https://www.facebook.com/plugins/page.php');
    const evil = run('<iframe src="https://evil.example.com/tracker"></iframe>').source;
    expect(evil).not.toContain('evil.example.com'); // non-allowlisted → dropped
    expect(() => validateTemplate(yt)).not.toThrow();
  });

  it('promotes a data-srcset and a data-bg lazy background', () => {
    const { source } = run('<img data-srcset="/logo.png 1x" alt="x"><div data-bg="/logo.png" class="hero">h</div>');
    expect(source).toContain('src="/media/p/a/logo.jpg"');
    expect(source).toContain("background-image:url('/media/p/a/logo.jpg')");
    expect(source).not.toMatch(/data-(srcset|bg)/);
  });

  it('renames skeleton landmarks and produces validateTemplate-clean source', () => {
    const { source } = run('<nav>menu</nav><main><footer>f</footer><aside>a</aside></main>');
    expect(source).not.toMatch(/<(nav|main|footer|aside)[\s>]/);
    expect(() => validateTemplate(source)).not.toThrow();
  });

  it('drops scripts and reports them', () => {
    const { source, diagnostics } = run('<p>hi</p><script>alert(1)</script>');
    expect(source).not.toContain('<script');
    expect(diagnostics.some((d) => d.code === 'script-dropped')).toBe(true);
  });

  it('strips on* handlers and data-sw-* attributes', () => {
    const { source } = run('<button onclick="x()" data-sw-text="k">b</button>');
    expect(source).not.toContain('onclick');
    expect(source).not.toContain('data-sw-text');
    expect(() => validateTemplate(source)).not.toThrow();
  });

  it('neutralizes stray mustaches so they cannot start an expression', () => {
    const { source } = run('<p>Price {{total}} now</p>');
    expect(source).not.toContain('{{');
    expect(() => validateTemplate(source)).not.toThrow();
  });

  it('rewrites internal links to routes, keeps external, neutralizes unsafe', () => {
    const { source } = run('<a href="contact">c</a><a href="https://x.com/y">y</a><a href="javascript:alert(1)">z</a>');
    expect(source).toContain('href="/contact"');
    expect(source).toContain('href="https://x.com/y"');
    expect(source).toContain('href="#"');
    expect(source).not.toContain('javascript:');
  });

  it('rewrites images to hosted refs, keeps https hotlinks, collapses srcset', () => {
    const { source } = run('<img src="/logo.png" srcset="/logo.png 1x, /logo@2x.png 2x"><img src="https://ex.com/missing.png">');
    expect(source).toContain('/media/p/a/logo.jpg');
    expect(source).not.toContain('srcset');
    expect(source).toContain('https://ex.com/missing.png');
  });

  it('drops an unhostable image on the synthetic upload host (no dead link)', () => {
    const uctx: TransformCtx = { pageUrl: 'https://import.local/about', siteBase: 'https://import.local/', internalRoutes: new Map(), assetMap: new Map(), limits: DEFAULT_LIMITS };
    const { source } = transformBody(parse('<html><body><img src="/img/missing.png" alt="x"></body></html>'), uctx);
    expect(source).not.toContain('import.local');
    expect(source).not.toContain('missing.png');
  });

  it('keeps inline data:image URIs verbatim', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const { source } = run(`<img src="${dataUri}">`);
    expect(source).toContain(dataUri);
  });

  it('rewrites a background-image url() to the hosted ref', () => {
    const { source } = run('<div style="background-image:url(/logo.png)">x</div>');
    expect(source).toContain("url('/media/p/a/logo.jpg')");
  });

  it('converts forms to inert divs', () => {
    const { source, diagnostics } = run('<form action="/submit"><input name="q"></form>');
    expect(source).not.toContain('<form');
    expect(source).toContain('<div');
    expect(diagnostics.some((d) => d.code === 'form-inerted')).toBe(true);
  });

  it('drops a non-https iframe and a non-allowlisted https iframe; keeps an allowlisted embed', () => {
    const { source } = run('<iframe src="http://insecure/x"></iframe><iframe src="https://random.example/y"></iframe><iframe src="https://player.vimeo.com/video/123"></iframe>');
    expect(source).not.toContain('http://insecure');
    expect(source).not.toContain('random.example'); // https but not an allowlisted embed host → dropped
    expect(source).toContain('https://player.vimeo.com/video/123');
  });

  it('trims oversized pages to the source byte cap', () => {
    const big = '<section>x</section>'.repeat(400);
    const tiny: TransformCtx = { ...ctx, limits: { ...DEFAULT_LIMITS, maxSourceBytes: 500 } };
    const { source, diagnostics } = transformBody(parse(`<html><body>${big}</body></html>`), tiny);
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(500);
    expect(diagnostics.some((d) => d.code === 'source-truncated')).toBe(true);
  });

  it('reduces a single oversized element to fitting text', () => {
    const huge = `<div>${'x'.repeat(5000)}</div>`; // one top-level element — can't trim siblings
    const tiny: TransformCtx = { ...ctx, limits: { ...DEFAULT_LIMITS, maxSourceBytes: 500 } };
    const { source, diagnostics } = transformBody(parse(`<html><body>${huge}</body></html>`), tiny);
    expect(Buffer.byteLength(source, 'utf8')).toBeLessThanOrEqual(500);
    expect(source).toContain('sw-import-fallback');
    expect(diagnostics.some((d) => d.code === 'source-truncated')).toBe(true);
  });

  it('handles a bare fragment without <body>', () => {
    const { source } = transformBody(parse('<p>just text</p>'), ctx);
    expect(source).toContain('just text');
  });

  it('keeps an https video source + hosts its poster, drops a non-https media src', () => {
    const { source } = run('<video src="https://ex.com/v.mp4" poster="/logo.png"></video><audio src="http://x/a.mp3"></audio>');
    expect(source).toContain('https://ex.com/v.mp4');
    expect(source).toContain('poster="/media/p/a/logo.jpg"');
    expect(source).not.toContain('http://x/a.mp3');
  });

  it('keeps an https <source src> inside a media element', () => {
    const { source } = run('<video><source src="https://ex.com/v.webm"></video>');
    expect(source).toContain('https://ex.com/v.webm');
  });

  it('keeps empty/anchor hrefs and does not let srcset override an existing src', () => {
    const { source } = run('<a href="">e</a><a href="#x">x</a><img src="/logo.png" srcset="/big.png 2x">');
    expect(source).toContain('href="#x"');
    expect(source).toContain('/media/p/a/logo.jpg');
    expect(source).not.toContain('srcset');
    expect(source).not.toContain('/big.png');
  });

  it('strips a foreign back-to-top button + the wrapper it leaves empty (platform injects its own)', () => {
    const { source, diagnostics } = run('<p>real content</p><div class="floating"><button id="backtotop" class="scroll-top"><i class="fa fa-chevron-up"></i></button></div>');
    expect(source).toContain('real content');
    expect(source).not.toContain('backtotop');
    expect(source).not.toContain('scroll-top');
    expect(source).not.toContain('chevron-up');
    expect(source).not.toContain('floating'); // the empty wrapper div is removed too
    expect(diagnostics.some((d) => d.code === 'back-to-top-removed')).toBe(true);
  });

  it('keeps a wrapper that has OTHER content besides the back-to-top', () => {
    const { source } = run('<div class="bar"><span>Keep me</span><a class="back-to-top" href="#top">Top</a></div>');
    expect(source).not.toContain('back-to-top');
    expect(source).toContain('Keep me'); // sibling content preserved
    expect(source).toContain('class="bar"'); // wrapper kept (not empty)
  });

  it('strips HTML comments (dead weight in editable source), keeping the real content', () => {
    const { source } = run('<div><!-- a disabled legacy nav: <nav id="main-nav"><a href="/x">Old</a></nav> --><p>Real copy</p></div>');
    expect(source).not.toContain('<!--');
    expect(source).not.toContain('disabled legacy nav');
    expect(source).not.toContain('main-nav');
    expect(source).toContain('Real copy');
  });

  it('removes a bare (content-less) loading overlay but KEEPS a content-rich one (the hero)', () => {
    const bare = run('<div class="loading-overlay"><div class="spinner"></div></div><p>page</p>');
    expect(bare.source).not.toContain('loading-overlay');
    expect(bare.diagnostics.some((d) => d.code === 'preloader-removed')).toBe(true);

    // A "loading-overlay" that holds the headline + CTAs is the hero — it must NOT be stripped.
    const hero = run('<div class="loading-overlay"><h1>NEXT-GEN WEB DEVELOPMENT</h1><a href="#a">GET STARTED</a><a href="#b">ABOUT</a></div><p>page</p>');
    expect(hero.source).toContain('NEXT-GEN WEB DEVELOPMENT');
    expect(hero.source).toContain('GET STARTED');
    expect(hero.diagnostics.some((d) => d.code === 'preloader-removed')).toBe(false);
  });

  it('still removes a preloader that has only ICON-ONLY links (social icons are not CTAs)', () => {
    // ≥2 links but NO text labels + little text ⇒ a real loader, not a hero. Must be stripped.
    const { source, diagnostics } = run(
      '<div class="preloader"><a href="/"><img src="/logo.png"></a>' +
        '<a href="https://fb.com/co"><i class="fab fa-facebook"></i></a>' +
        '<a href="https://twitter.com/co"><i class="fab fa-twitter"></i></a></div><p>real page</p>',
    );
    expect(source).not.toContain('preloader');
    expect(source).not.toContain('fa-facebook');
    expect(source).toContain('real page');
    expect(diagnostics.some((d) => d.code === 'preloader-removed')).toBe(true);
  });
});
