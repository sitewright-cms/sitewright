import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';
import {
  rewriteMediaUrlsFlat,
  resolveThumbForHead,
  rebaseMediaHeadUrl,
  materializeImageThumbs,
  type ThumbRefs,
} from '../src/publish/media-thumbs.js';

// A readable identity alias so flat names assert as `<id>-<name>` (the real alias is a 6-char hash).
const idAlias = (id: string): string => id;

describe('rewriteMediaUrlsFlat', () => {
  it('rewrites sized image delivery urls to FLAT static thumbnail names + records refs', () => {
    const refs: ThumbRefs = new Map();
    const html = `<img src="/media/acme/a1/photo.jpg?size=lg&format=webp"><img src="/media/acme/a2/hero.png">`;
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/a1-photo-lg.webp');
    expect(out).toContain('_assets/a2-hero-xl.webp'); // bare ⇒ xl default
    expect(out).not.toContain('?size=');
    expect(out).not.toContain('/media/acme/'); // fully rebased in one pass
    expect(refs.get('a1')?.thumbs.has('lg:webp')).toBe(true);
    expect(refs.get('a2')?.thumbs.has('xl:webp')).toBe(true);
  });

  it('rebases onto the page-relative site root (portable at any depth)', () => {
    const refs: ThumbRefs = new Map();
    const out = rewriteMediaUrlsFlat('<img src="/media/acme/a1/photo.jpg?size=lg">', 'acme', '../', refs, idAlias);
    expect(out).toContain('../_assets/a1-photo-lg.webp');
  });

  it('honours size=original (strips query, keeps the original name, records the original ref)', () => {
    const refs: ThumbRefs = new Map();
    const out = rewriteMediaUrlsFlat('<a href="/media/acme/a1/doc.png?size=original">x</a>', 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/a1-doc.png');
    expect(out).not.toContain('?size=');
    expect(refs.get('a1')?.original).toBe(true);
    expect(refs.get('a1')?.thumbs.size).toBe(0);
  });

  it('rebases non-image + raw /file/ media urls to flat names (no ref recorded)', () => {
    const refs: ThumbRefs = new Map();
    const html = `url(/media/acme/f1/styles.css) /media/acme/f2/font.woff2 /media/acme/f3/file/report.pdf`;
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/f1-styles.css');
    expect(out).toContain('_assets/f2-font.woff2');
    expect(out).toContain('_assets/f3-report.pdf'); // raw `/file/` segment dropped, flat
    expect(out).not.toContain('/media/acme/');
    expect(refs.size).toBe(0); // non-images are copied by copyMedia, no thumbnail ref
  });

  it('catches urls inside CSS url() and srcset (delimiter-agnostic)', () => {
    const refs: ThumbRefs = new Map();
    const html = `background:url('/media/acme/a1/bg.jpg?size=md');|srcset="/media/acme/a1/bg.jpg?size=sm 1x"`;
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toContain("url('_assets/a1-bg-md.webp')");
    expect(out).toContain('_assets/a1-bg-sm.webp 1x');
    expect(refs.get('a1')?.thumbs.has('md:webp')).toBe(true);
    expect(refs.get('a1')?.thumbs.has('sm:webp')).toBe(true);
  });

  it('does not rewrite another project slug', () => {
    const refs: ThumbRefs = new Map();
    const html = '<img src="/media/other/a1/photo.jpg?size=lg">';
    expect(rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias)).toBe(html);
    expect(refs.size).toBe(0);
  });

  it('records an SVG image as an ORIGINAL ref (copied verbatim), strips any ?size, keeps the .svg name', () => {
    const refs: ThumbRefs = new Map();
    const out = rewriteMediaUrlsFlat('<img src="/media/acme/s1/logo.svg?size=lg">', 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/s1-logo.svg');
    expect(out).not.toContain('?size=');
    expect(out).not.toContain('logo-lg'); // never thumbnailed
    expect(refs.get('s1')?.original).toBe(true);
    expect(refs.get('s1')?.thumbs.size).toBe(0);
  });
});

describe('resolveThumbForHead', () => {
  it('resolves a media image to a FLAT bundled thumbnail path + records the ref', () => {
    const refs: ThumbRefs = new Map();
    const url = resolveThumbForHead('/media/acme/og/pic.jpg', '/media/acme/', '_assets/', 'lg', 'webp', refs, idAlias);
    expect(url).toBe('_assets/og-pic-lg.webp');
    expect(refs.get('og')?.thumbs.has('lg:webp')).toBe(true);
  });

  it('returns undefined for a non-media url (caller falls back)', () => {
    const refs: ThumbRefs = new Map();
    expect(resolveThumbForHead('https://cdn/y.jpg', '/media/acme/', '_assets/', 'lg', 'webp', refs, idAlias)).toBeUndefined();
    expect(refs.size).toBe(0);
  });

  it('resolves an SVG head image to its verbatim FLAT original (no thumbnail variant)', () => {
    const refs: ThumbRefs = new Map();
    const url = resolveThumbForHead('/media/acme/s1/logo.svg', '/media/acme/', '_assets/', 'lg', 'webp', refs, idAlias);
    expect(url).toBe('_assets/s1-logo.svg');
    expect(refs.get('s1')?.original).toBe(true);
    expect(refs.get('s1')?.thumbs.size).toBe(0);
  });
});

describe('rebaseMediaHeadUrl', () => {
  it('rebases a non-image head media url to its flat path', () => {
    const refs: ThumbRefs = new Map();
    expect(rebaseMediaHeadUrl('/media/acme/f1/brand.css', '/media/acme/', '_assets/', refs, idAlias)).toBe(
      '_assets/f1-brand.css',
    );
  });

  it('rebases a raw /file/ head media url (segment dropped)', () => {
    const refs: ThumbRefs = new Map();
    expect(rebaseMediaHeadUrl('/media/acme/f2/file/spec.pdf', '/media/acme/', '_assets/', refs, idAlias)).toBe(
      '_assets/f2-spec.pdf',
    );
  });

  it('records an svg original ref and returns undefined for a non-media url', () => {
    const refs: ThumbRefs = new Map();
    expect(rebaseMediaHeadUrl('/media/acme/s1/logo.svg', '/media/acme/', '_assets/', refs, idAlias)).toBe(
      '_assets/s1-logo.svg',
    );
    expect(refs.get('s1')?.original).toBe(true);
    expect(rebaseMediaHeadUrl('https://cdn/x.css', '/media/acme/', '_assets/', refs, idAlias)).toBeUndefined();
  });
});

describe('materializeImageThumbs', () => {
  let dir = '';
  let png: Buffer = Buffer.alloc(0);
  const asset: MediaAsset = {
    kind: 'image',
    id: 'a1',
    filename: 'p.png',
    folder: '',
    bytes: 100,
    format: 'png',
    width: 100,
    height: 80,
    hasAlpha: false,
    animated: false,
    original: 'p.png',
    url: '/media/x/a1/p.png',
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-mat-'));
    png = await renderTrustedSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#0a7"/></svg>', 100, 80);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('generates ONLY the referenced thumbnails (+ referenced original) FLAT into _assets/', async () => {
    const refs: ThumbRefs = new Map([['a1', { thumbs: new Set(['sm:webp', 'lg:avif']), original: true }]]);
    await materializeImageThumbs(dir, [{ ...asset, bytes: png.length }], refs, async () => png, idAlias);
    expect(existsSync(join(dir, '_assets', 'a1-p-sm.webp'))).toBe(true);
    expect(existsSync(join(dir, '_assets', 'a1-p-lg.avif'))).toBe(true);
    expect(existsSync(join(dir, '_assets', 'a1-p.png'))).toBe(true); // original referenced ⇒ copied
    // no per-asset subfolder is created
    expect(existsSync(join(dir, '_assets', 'a1'))).toBe(false);
    // an UNreferenced size is never produced (minimal)
    expect(existsSync(join(dir, '_assets', 'a1-p-md.webp'))).toBe(false);
    const b = await readFile(join(dir, '_assets', 'a1-p-sm.webp'));
    expect(b.toString('ascii', 0, 4)).toBe('RIFF'); // valid WebP container
  });

  it('copies an SVG original VERBATIM (no thumbnails generated, no sharp)', async () => {
    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40"/></svg>');
    const svgAsset: MediaAsset = {
      kind: 'image',
      id: 'sv1',
      filename: 'logo.svg',
      folder: '',
      bytes: svgBytes.length,
      format: 'svg',
      width: 100,
      height: 40,
      hasAlpha: true,
      animated: false,
      original: 'logo.svg',
      url: '/media/x/sv1/logo.svg',
    };
    // The publish rewrite only ever records an SVG as an original ref (thumbs stays empty).
    const refs: ThumbRefs = new Map([['sv1', { thumbs: new Set(), original: true }]]);
    await materializeImageThumbs(dir, [svgAsset], refs, async () => svgBytes, idAlias);
    const out = join(dir, '_assets', 'sv1-logo.svg');
    expect(existsSync(out)).toBe(true);
    expect(await readFile(out)).toEqual(svgBytes); // byte-for-byte, not rasterized
  });

  it('skips an asset whose original is missing (ENOENT tolerated, build not failed)', async () => {
    const refs: ThumbRefs = new Map([['a2', { thumbs: new Set(['xl:webp']), original: false }]]);
    const media = [{ ...asset, id: 'a2', original: 'q.png' }];
    await materializeImageThumbs(dir, media, refs, async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }, idAlias);
    expect(existsSync(join(dir, '_assets', 'a2-q-xl.webp'))).toBe(false);
  });
});
