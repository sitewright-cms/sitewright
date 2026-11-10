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
  ThumbMaterializer,
  encodeEstimateBytes,
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

  it('reads an HTML-escaped `&amp;` query (a re-serialized AVIF srcset) and consumes all of it', () => {
    // The directive pass re-serializes any page carrying a data-sw-* marker, and the serializer writes
    // `&` in an attribute as `&amp;`. Stopping at the `;` read `size=sm&amp` — format lost (a WebP
    // file named for an AVIF source) — and left `;format=avif` glued onto the rewritten path.
    const refs: ThumbRefs = new Map();
    const html = '<source type="image/avif" srcset="/media/acme/a1-p.jpg?size=sm&amp;format=avif 500w, /media/acme/a1-p.jpg?size=md&format=avif 900w">';
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toBe('<source type="image/avif" srcset="_assets/a1-p-sm.avif 500w, _assets/a1-p-md.avif 900w">');
    expect([...(refs.get('a1')?.thumbs ?? [])].sort()).toEqual(['md:avif', 'sm:avif']);
  });

  it('does not rewrite another project slug', () => {
    const refs: ThumbRefs = new Map();
    const html = '<img src="/media/other/a1/photo.jpg?size=lg">';
    expect(rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias)).toBe(html);
    expect(refs.size).toBe(0);
  });

  it('★ leaves an ABSOLUTE or nested media url untouched — only a ROOT-RELATIVE one is the project\'s', () => {
    // Unanchored, `https://cms.example.com/media/acme/…` had its path rewritten in place and shipped as
    // `https://cms.example.com../_assets/…` — a url that resolves nowhere.
    const refs: ThumbRefs = new Map();
    const html = [
      '<img src="https://cms.example.com/media/acme/a1-photo.jpg?size=lg">',
      'a{background:url(//cdn.example.com/media/acme/a2-bg.png)}',
      '<a href="/elsewhere/media/acme/a3-doc.pdf">',
    ].join('');
    expect(rewriteMediaUrlsFlat(html, 'acme', '../', refs, idAlias)).toBe(html);
    expect(refs.size).toBe(0);
  });

  it('still rewrites a root-relative url after every delimiter a page actually puts before one', () => {
    const refs: ThumbRefs = new Map();
    const html =
      `<img src="/media/acme/a1-x.png"><img src='/media/acme/a1-x.png'>url(/media/acme/a1-x.png) ` +
      `srcset="/media/acme/a1-x.png 1x,/media/acme/a1-x.png 2x" data-x=&quot;/media/acme/a1-x.png&quot;>/media/acme/a1-x.png`;
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).not.toContain('/media/acme/');
    expect(out.match(/_assets\/a1-x-xl\.webp/g)).toHaveLength(7);
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

// The CURRENT editor media-url scheme is FLAT: `/media/<slug>/<id>-<name>` (short id + '-' + filename,
// no per-asset folder — [[media-flat-scheme-epic]]). Publishing a project whose assets are on that scheme
// must rebase these urls exactly like the legacy `<id>/<name>` folder shape — a regression here shipped
// EVERY image as an un-rebased `/media/…` 404 on the published site.
describe('media rebase — FLAT <id>-<name> scheme', () => {
  it('rewriteMediaUrlsFlat rebases flat sized + bare + name-with-hyphens image urls', () => {
    const refs: ThumbRefs = new Map();
    const html =
      `<img src="/media/acme/a1-photo.jpg?size=lg&format=webp">` +
      `<img src="/media/acme/a2-hero.png">` +
      `<img src="/media/acme/bz-brand-logo.png">`; // the live-bug shape (id `bz`, name `brand-logo.png`)
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/a1-photo-lg.webp');
    expect(out).toContain('_assets/a2-hero-xl.webp'); // bare ⇒ xl default
    expect(out).toContain('_assets/bz-brand-logo-xl.webp'); // id split at FIRST hyphen, name keeps the rest
    expect(out).not.toContain('/media/acme/'); // fully rebased — no leftover 404 urls
    expect(refs.get('bz')?.thumbs.has('xl:webp')).toBe(true);
  });

  it('rewriteMediaUrlsFlat handles flat svg + non-image + size=original', () => {
    const refs: ThumbRefs = new Map();
    const html = `/media/acme/s1-logo.svg /media/acme/f1-styles.css /media/acme/a1-doc.png?size=original`;
    const out = rewriteMediaUrlsFlat(html, 'acme', '', refs, idAlias);
    expect(out).toContain('_assets/s1-logo.svg');
    expect(out).toContain('_assets/f1-styles.css');
    expect(out).toContain('_assets/a1-doc.png');
    expect(out).not.toContain('/media/acme/');
    expect(refs.get('s1')?.original).toBe(true);
    expect(refs.get('a1')?.original).toBe(true);
  });

  it('resolveThumbForHead + rebaseMediaHeadUrl resolve flat urls (og:image / logo)', () => {
    const refs: ThumbRefs = new Map();
    expect(resolveThumbForHead('/media/acme/og-pic.jpg', '/media/acme/', '_assets/', 'lg', 'webp', refs, idAlias)).toBe(
      '_assets/og-pic-lg.webp',
    );
    expect(resolveThumbForHead('/media/acme/lg-brand-logo.png', '/media/acme/', '_assets/', 'lg', 'webp', refs, idAlias)).toBe(
      '_assets/lg-brand-logo-lg.webp', // id `lg`, name `brand-logo.png` → thumbnail
    );
    expect(rebaseMediaHeadUrl('/media/acme/f1-brand.css', '/media/acme/', '_assets/', refs, idAlias)).toBe(
      '_assets/f1-brand.css',
    );
  });

  it('leaves a bare/malformed flat ref untouched (no name after the id)', () => {
    const refs: ThumbRefs = new Map();
    // `/media/acme/nohyphen` has no `-` → not a valid flat url → left as-is rather than mis-rebased.
    expect(rewriteMediaUrlsFlat('<a href="/media/acme/nohyphen">x</a>', 'acme', '', refs, idAlias)).toContain(
      '/media/acme/nohyphen',
    );
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
    // A cold store: only the original is present, so every variant is a cache MISS and gets encoded.
    const coldStore = async (_id: string, file: string): Promise<Buffer> => {
      if (file === 'p.png') return png;
      throw Object.assign(new Error('miss'), { code: 'ENOENT' });
    };
    await materializeImageThumbs(dir, [{ ...asset, bytes: png.length }], refs, coldStore, idAlias);
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

  it('reuses a CACHED derivative instead of re-encoding, and never touches the original', async () => {
    const refs: ThumbRefs = new Map([['a3', { thumbs: new Set(['sm:webp']), original: false }]]);
    const cached = Buffer.from('RIFFcached-webp-bytes');
    const reads: string[] = [];
    await materializeImageThumbs(dir, [{ ...asset, id: 'a3' }], refs, async (_id, file) => {
      reads.push(file);
      if (file === 'p-sm.webp') return cached;
      throw new Error('the original must not be read when every variant is cached');
    }, idAlias);
    expect(await readFile(join(dir, '_assets', 'a3-p-sm.webp'))).toEqual(cached);
    expect(reads).toEqual(['p-sm.webp']); // the 50 MB original was never decoded
  });

  it('encodes only the MISSING variants and puts each one back in the store', async () => {
    const refs: ThumbRefs = new Map([['a4', { thumbs: new Set(['sm:webp', 'lg:webp']), original: false }]]);
    const cached = Buffer.from('RIFFcached-sm');
    const stored: string[] = [];
    await materializeImageThumbs(
      dir,
      [{ ...asset, id: 'a4', bytes: png.length }],
      refs,
      async (_id, file) => {
        if (file === 'p-sm.webp') return cached;
        if (file === 'p-lg.webp') throw Object.assign(new Error('miss'), { code: 'ENOENT' });
        return png; // the original, needed for the lg miss
      },
      idAlias,
      async (_id, file) => {
        stored.push(file);
      },
    );
    expect(await readFile(join(dir, '_assets', 'a4-p-sm.webp'))).toEqual(cached); // hit: byte-identical
    expect((await readFile(join(dir, '_assets', 'a4-p-lg.webp'))).toString('ascii', 0, 4)).toBe('RIFF'); // miss: encoded
    expect(stored).toEqual(['p-lg.webp']); // only the miss is written back
  });

  it('completes the build when writing back to the store fails', async () => {
    const refs: ThumbRefs = new Map([['a5', { thumbs: new Set(['sm:webp']), original: false }]]);
    await materializeImageThumbs(
      dir,
      [{ ...asset, id: 'a5', bytes: png.length }],
      refs,
      async (_id, file) => {
        if (file === 'p-sm.webp') throw Object.assign(new Error('miss'), { code: 'ENOENT' });
        return png;
      },
      idAlias,
      async () => {
        throw new Error('read-only store');
      },
    );
    expect(existsSync(join(dir, '_assets', 'a5-p-sm.webp'))).toBe(true);
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

describe('ThumbMaterializer — incremental, parallel, by path', () => {
  let png: Buffer = Buffer.alloc(0);
  const roots: string[] = [];
  const image = (id: string): MediaAsset => ({
    kind: 'image',
    id,
    filename: `${id}.png`,
    folder: '',
    bytes: 100,
    format: 'png',
    width: 100,
    height: 80,
    hasAlpha: false,
    animated: false,
    original: `${id}.png`,
    url: `/media/x/${id}/${id}.png`,
  });
  const media = ['a1', 'a2', 'a3', 'a4'].map(image);
  const listing = async (root: string): Promise<Record<string, string>> => {
    const { readdir } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const out: Record<string, string> = {};
    for (const f of (await readdir(join(root, '_assets'))).sort()) {
      out[f] = createHash('sha256').update(await readFile(join(root, '_assets', f))).digest('hex');
    }
    return out;
  };
  beforeAll(async () => {
    png = await renderTrustedSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80" fill="#a07"/></svg>', 100, 80);
  });
  afterAll(async () => {
    for (const r of roots) await rm(r, { recursive: true, force: true });
  });

  it('★ scheduled in pieces, in parallel and by path, it writes EXACTLY the files of the one-shot pass', async () => {
    // A store with the originals and one cached derivative (a2's sm), on disk for the path lane.
    const { writeFile } = await import('node:fs/promises');
    const store = await mkdtemp(join(tmpdir(), 'sw-mat-store-'));
    roots.push(store);
    for (const m of media) await writeFile(join(store, `${m.id}-${m.id}.png`), png);
    const cachedSm = Buffer.from('cached-derivative-bytes');
    await writeFile(join(store, 'a2-a2-sm.webp'), cachedSm);
    const path = (id: string, file: string): string => join(store, `${id}-${file}`);
    const read = async (id: string, file: string): Promise<Buffer> => readFile(path(id, file));
    const all: ThumbRefs = new Map([
      ['a1', { thumbs: new Set(['sm:webp', 'md:webp']), original: true }],
      ['a2', { thumbs: new Set(['sm:webp']), original: false }],
      ['a3', { thumbs: new Set(['lg:avif']), original: false }],
      ['a4', { thumbs: new Set(['xs:webp']), original: true }],
    ]);

    const oneShot = await mkdtemp(join(tmpdir(), 'sw-mat-one-'));
    roots.push(oneShot);
    await materializeImageThumbs(oneShot, media, all, read, idAlias);

    const pieces = await mkdtemp(join(tmpdir(), 'sw-mat-pieces-'));
    roots.push(pieces);
    const estimates: number[] = [];
    let running = 0;
    let peak = 0;
    const m = new ThumbMaterializer(pieces, media, read, idAlias, undefined, {
      filePath: path,
      encodeConcurrency: 3,
      runEncode: async (bytes, fn) => {
        estimates.push(bytes);
        running += 1;
        peak = Math.max(peak, running);
        try {
          return await fn();
        } finally {
          running -= 1;
        }
      },
    });
    // As a build does: what the first pages wanted, then more of the same images, then the rest.
    m.schedule(new Map([['a1', { thumbs: new Set(['sm:webp']), original: false }]]));
    m.schedule(new Map([['a1', { thumbs: new Set(['sm:webp', 'md:webp']), original: true }], ['a2', { thumbs: new Set(['sm:webp']), original: false }]]));
    m.schedule(all);
    m.schedule(all); // repeated scheduling queues nothing twice
    const progress: number[] = [];
    await m.finish((done) => progress.push(done));

    expect(await listing(pieces)).toEqual(await listing(oneShot));
    expect((await readFile(join(pieces, '_assets', 'a2-a2-sm.webp'))).equals(cachedSm)).toBe(true); // a hit is copied
    // Every MISS is encoded through the admission, with its estimate: a1 sm + md, a3 lg, a4 xs (a2 sm was a hit).
    expect(estimates).toEqual(Array(4).fill(encodeEstimateBytes(100, 80)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect(Math.max(...progress)).toBeLessThanOrEqual(all.size);
    expect(progress.at(-1)).toBe(all.size);
  });

  it('a failure starts nothing more, and fails the pass once what was running has settled', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sw-mat-fail-'));
    roots.push(out);
    const reads: string[] = [];
    const read = async (id: string): Promise<Buffer> => {
      reads.push(id);
      if (id === 'a1') throw Object.assign(new Error('disk exploded'), { code: 'EIO' });
      return png;
    };
    const refs: ThumbRefs = new Map(media.map((a) => [a.id, { thumbs: new Set<string>(), original: true }]));
    const m = new ThumbMaterializer(out, media, read, idAlias, undefined, { ioConcurrency: 1 });
    m.schedule(refs);
    await expect(m.finish()).rejects.toThrow('disk exploded');
    expect(reads).toEqual(['a1']); // the queued copies after the failure never started
  });

  it('★ a progress callback that throws (an aborted build) fails the pass — it never escapes as an unhandled rejection', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sw-mat-abort-'));
    roots.push(out);
    const refs: ThumbRefs = new Map(media.map((a) => [a.id, { thumbs: new Set<string>(), original: true }]));
    const m = new ThumbMaterializer(out, media, async () => png, idAlias);
    m.schedule(refs);
    let calls = 0;
    await expect(
      m.finish(() => {
        calls += 1;
        if (calls > 1) throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
  });

  it('cancel() skips what has not started', async () => {
    const out = await mkdtemp(join(tmpdir(), 'sw-mat-cancel-'));
    roots.push(out);
    const reads: string[] = [];
    const m = new ThumbMaterializer(out, media, async (id) => (reads.push(id), png), idAlias, undefined, { ioConcurrency: 1 });
    m.schedule(new Map(media.map((a) => [a.id, { thumbs: new Set<string>(), original: true }])));
    m.cancel();
    await m.finish();
    expect(reads).toEqual([]);
  });
});
