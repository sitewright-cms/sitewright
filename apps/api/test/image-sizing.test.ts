import { describe, it, expect } from 'vitest';
import { extractImageRefs, analyzeImageSizing, rungOf } from '../src/render/image-sizing.js';

const analyze = (html: string) => analyzeImageSizing(extractImageRefs(html));

describe('rungOf', () => {
  it('reads the delivery rung out of a published asset name', () => {
    expect(rungOf('UiMkSY-pexels-34338597-xl.webp')).toBe('xl');
    expect(rungOf('a-b-md.webp')).toBe('md');
    expect(rungOf('logo-xs.avif')).toBe('xs');
  });

  it('returns nothing for an original, an SVG, or a non-asset — none of which is a sizing finding', () => {
    // `?size=original` and SVG are DELIBERATE choices (an SVG scales natively); flagging them would
    // be second-guessing the author rather than reporting an unchosen default.
    expect(rungOf('wzixQv-tuhafifa-bg.webp')).toBeUndefined();
    expect(rungOf('icon.svg')).toBeUndefined();
    expect(rungOf('noextension')).toBeUndefined();
    expect(rungOf('-xl.webp')).toBeUndefined(); // no stem
  });
});

describe('what Lighthouse cannot see: an oversized CSS BACKGROUND', () => {
  it('flags a background delivered at the largest rung', () => {
    const r = analyze(`<div style="background-image:url('../_assets/UiMkSY-pexels-34338597-xl.webp')"></div>`);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ file: 'UiMkSY-pexels-34338597-xl.webp', via: 'background', size: 'xl', rungWidth: 2400, count: 1 });
    expect(r.findings[0]!.recommendation).toMatch(/\?size=/);
  });

  it('flags the platform lazy background (data-bg) the same way', () => {
    const r = analyze(`<div data-bg="/_assets/a-photo-xl.webp"></div>`);
    expect(r.findings[0]).toMatchObject({ via: 'background', rungWidth: 2400 });
  });

  it('counts repeats of the same background instead of listing it twice', () => {
    const one = `<div style="background-image:url('/_assets/a-b-xl.webp')"></div>`;
    const r = analyze(one + one + one);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.count).toBe(3);
  });

  it('leaves a SIZED background alone — someone chose that rung', () => {
    const r = analyze(`<div style="background-image:url('/_assets/a-b-md.webp')"></div>`);
    expect(r.findings).toHaveLength(0);
    expect(r.ok).toBe(1);
  });

  it('ignores an inline data: LQIP — it is not a delivered asset', () => {
    const r = analyze(`<img style="background-image:url('data:image/webp;base64,AAAA')" src="/_assets/a-b-md.webp">`);
    expect(r.findings).toHaveLength(0);
  });
});

describe('an <img> that cannot adapt', () => {
  it('flags a srcset-less <img> at the largest rung', () => {
    const r = analyze(`<img src="/_assets/a-hero-xl.webp" alt="x">`);
    expect(r.findings[0]).toMatchObject({ via: 'img', rungWidth: 2400 });
    expect(r.findings[0]!.recommendation).toMatch(/srcset/);
  });

  it('leaves an <img> WITH a srcset alone at any rung — the browser picks', () => {
    // This is what the responsive helper emits, so a page that used it must not be nagged.
    const r = analyze(`<img src="/_assets/a-hero-xl.webp" srcset="/_assets/a-hero-sm.webp 500w, /_assets/a-hero-xl.webp 2400w" sizes="50vw" alt="x">`);
    expect(r.findings).toHaveLength(0);
    expect(r.ok).toBeGreaterThan(0);
  });

  it('understands the lazy data-src/data-srcset pair too', () => {
    expect(analyze(`<img data-src="/_assets/a-b-xl.webp" data-srcset="/_assets/a-b-sm.webp 500w" alt="">`).findings).toHaveLength(0);
    expect(analyze(`<img data-src="/_assets/a-b-xl.webp" alt="">`).findings).toHaveLength(1);
  });
});

describe('bounds', () => {
  it('caps the rendered findings and reports the remainder', () => {
    let html = '';
    for (let i = 0; i < 20; i++) html += `<div style="background-image:url('/_assets/a${i}-p-xl.webp')"></div>`;
    const r = analyze(html);
    expect(r.findings).toHaveLength(12);
    expect(r.truncated).toBe(8);
  });

  it('stays linear on pathological author markup (no ReDoS on an unclosed tag)', () => {
    // heading-outline.ts learned this the hard way: never a lazy quantifier over author HTML.
    const hostile = '<img ' + 'a'.repeat(300_000);
    const started = process.hrtime.bigint();
    analyze(hostile);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(1000);
  });
});

describe('the real page this check was built for', () => {
  // The published HTML of a page that dropped NINE frames on first scroll while Lighthouse scored
  // its image delivery a perfect 1. Shape reproduced from the real markup.
  const page =
    `<style>.hero{background-image:url('../_assets/G27Rnh-unsplash-jmWFNK7ZvbY-xl.webp')}</style>` +
    `<div style="background-image:url('../_assets/UiMkSY-pexels-34338597-xl.webp')"></div>` +
    `<div style="background-image:url('../_assets/wC0IWx-pexels-18283441-xl.webp')"></div>` +
    `<div style="background-image:url('../_assets/PX1teM-pexels-18283538-xl.webp')"></div>` +
    `<img src="../_assets/69RbYk-tuhafifa-construction-logo-xl.webp" alt="logo">` +
    `<img src="../_assets/eZQRIM-malakia-naholo-md.webp" alt="ok, sized">`;

  it('names every unsized reference Lighthouse stayed silent about', () => {
    const r = analyze(page);
    expect(r.findings.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        'G27Rnh-unsplash-jmWFNK7ZvbY-xl.webp',
        'UiMkSY-pexels-34338597-xl.webp',
        'wC0IWx-pexels-18283441-xl.webp',
        'PX1teM-pexels-18283538-xl.webp',
        '69RbYk-tuhafifa-construction-logo-xl.webp',
      ]),
    );
    expect(r.findings).toHaveLength(5);
    expect(r.ok).toBe(1); // the one already-sized <img>
    expect(r.findings.filter((f) => f.via === 'background')).toHaveLength(4);
  });

  it('reports nothing once the page is fixed', () => {
    const r = analyze(page.replace(/-xl\.webp/g, '-md.webp'));
    expect(r.findings).toHaveLength(0);
    expect(r.ok).toBe(6);
  });
});
