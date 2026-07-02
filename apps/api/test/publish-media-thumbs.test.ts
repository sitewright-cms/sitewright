import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import type { MediaAsset } from '@sitewright/schema';
import {
  rewriteMediaThumbUrls,
  resolveThumbForHead,
  materializeImageThumbs,
  type ThumbRefs,
} from '../src/publish/media-thumbs.js';

describe('rewriteMediaThumbUrls', () => {
  it('rewrites sized image delivery urls to static thumbnail names + records refs', () => {
    const refs: ThumbRefs = new Map();
    const html = `<img src="/media/acme/a1/photo.jpg?size=lg&format=webp"><img src="/media/acme/a2/hero.png">`;
    const out = rewriteMediaThumbUrls(html, 'acme', refs);
    expect(out).toContain('/media/acme/a1/photo-lg.webp');
    expect(out).toContain('/media/acme/a2/hero-xl.webp'); // bare ⇒ xl default
    expect(out).not.toContain('?size=');
    expect(refs.get('a1')?.thumbs.has('lg:webp')).toBe(true);
    expect(refs.get('a2')?.thumbs.has('xl:webp')).toBe(true);
  });

  it('honours size=original (strips query, keeps the original name, records the original ref)', () => {
    const refs: ThumbRefs = new Map();
    const out = rewriteMediaThumbUrls('<a href="/media/acme/a1/doc.png?size=original">x</a>', 'acme', refs);
    expect(out).toContain('/media/acme/a1/doc.png');
    expect(out).not.toContain('?size=');
    expect(refs.get('a1')?.original).toBe(true);
    expect(refs.get('a1')?.thumbs.size).toBe(0);
  });

  it('leaves non-image and /file/ media urls untouched', () => {
    const refs: ThumbRefs = new Map();
    const html = `url(/media/acme/f1/styles.css) /media/acme/f2/font.woff2 /media/acme/f3/file/report.pdf`;
    const out = rewriteMediaThumbUrls(html, 'acme', refs);
    expect(out).toBe(html); // unchanged
    expect(refs.size).toBe(0);
  });

  it('catches urls inside CSS url() and srcset (delimiter-agnostic)', () => {
    const refs: ThumbRefs = new Map();
    const html = `background:url('/media/acme/a1/bg.jpg?size=md');|srcset="/media/acme/a1/bg.jpg?size=sm 1x"`;
    const out = rewriteMediaThumbUrls(html, 'acme', refs);
    expect(out).toContain("url('/media/acme/a1/bg-md.webp')");
    expect(out).toContain('/media/acme/a1/bg-sm.webp 1x');
    expect(refs.get('a1')?.thumbs.has('md:webp')).toBe(true);
    expect(refs.get('a1')?.thumbs.has('sm:webp')).toBe(true);
  });

  it('does not rewrite another project slug', () => {
    const refs: ThumbRefs = new Map();
    const html = '<img src="/media/other/a1/photo.jpg?size=lg">';
    expect(rewriteMediaThumbUrls(html, 'acme', refs)).toBe(html);
    expect(refs.size).toBe(0);
  });
});

describe('resolveThumbForHead', () => {
  it('resolves a media image to a bundled thumbnail path + records the ref', () => {
    const refs: ThumbRefs = new Map();
    const url = resolveThumbForHead('/media/acme/og/pic.jpg', '/media/acme/', '_assets/', 'lg', 'webp', refs);
    expect(url).toBe('_assets/og/pic-lg.webp');
    expect(refs.get('og')?.thumbs.has('lg:webp')).toBe(true);
  });

  it('returns undefined for a non-media url (caller falls back)', () => {
    const refs: ThumbRefs = new Map();
    expect(resolveThumbForHead('https://cdn/y.jpg', '/media/acme/', '_assets/', 'lg', 'webp', refs)).toBeUndefined();
    expect(refs.size).toBe(0);
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

  it('generates ONLY the referenced thumbnails (+ referenced original) from the retained original', async () => {
    const refs: ThumbRefs = new Map([['a1', { thumbs: new Set(['sm:webp', 'lg:avif']), original: true }]]);
    await materializeImageThumbs(dir, [{ ...asset, bytes: png.length }], refs, async () => png);
    expect(existsSync(join(dir, '_assets', 'a1', 'p-sm.webp'))).toBe(true);
    expect(existsSync(join(dir, '_assets', 'a1', 'p-lg.avif'))).toBe(true);
    expect(existsSync(join(dir, '_assets', 'a1', 'p.png'))).toBe(true); // original referenced ⇒ copied
    // an UNreferenced size is never produced (minimal)
    expect(existsSync(join(dir, '_assets', 'a1', 'p-md.webp'))).toBe(false);
    const b = await readFile(join(dir, '_assets', 'a1', 'p-sm.webp'));
    expect(b.toString('ascii', 0, 4)).toBe('RIFF'); // valid WebP container
  });

  it('skips an asset whose original is missing (ENOENT tolerated, build not failed)', async () => {
    const refs: ThumbRefs = new Map([['a2', { thumbs: new Set(['xl:webp']), original: false }]]);
    const media = [{ ...asset, id: 'a2', original: 'q.png' }];
    await materializeImageThumbs(dir, media, refs, async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    expect(existsSync(join(dir, '_assets', 'a2', 'q-xl.webp'))).toBe(false);
  });
});
