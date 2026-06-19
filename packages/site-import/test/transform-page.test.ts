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

  it('drops a non-https iframe but keeps an https one', () => {
    const { source } = run('<iframe src="http://insecure/x"></iframe><iframe src="https://ok/y"></iframe>');
    expect(source).not.toContain('http://insecure');
    expect(source).toContain('https://ok/y');
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
});
