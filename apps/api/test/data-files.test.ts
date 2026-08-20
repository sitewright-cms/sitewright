import { describe, it, expect } from 'vitest';
import { buildDataFiles, MAX_DATA_FILE_BYTES } from '../src/publish/data-files.js';
import type { MediaAsset } from '@sitewright/schema';

/**
 * PUBLISH-EMITTED `.json` DATA FILES (`website.dataFiles`).
 *
 * The pair to the on-page island: an island is re-sent with every page view, a file ships once and is
 * cached. What these tests protect is mostly the SILENT failure modes — a source that resolves to
 * nothing, two specs racing for one filename, a file that outgrew the cap. Each has to be visible in
 * the build result, because the page that fetches an empty list renders nothing and says nothing.
 */
const img = (over: Partial<MediaAsset> & { url: string; folder: string }): MediaAsset =>
  ({
    kind: 'image',
    id: over.url,
    filename: 'x.jpg',
    bytes: 1000,
    format: 'jpeg',
    width: 800,
    height: 600,
    hasAlpha: false,
    animated: false,
    original: 'x.jpg',
    ...over,
  }) as MediaAsset;

describe('buildDataFiles', () => {
  it('emits a dataset as a JSON array of its published rows', () => {
    const { files, warnings } = buildDataFiles({
      specs: [{ path: 'products.json', dataset: 'products' }],
      entries: { products: [{ values: { name: 'Cap', price: 120 } }, { values: { name: 'Scarf', price: 80 } }] },
      media: [],
    });
    expect(warnings).toEqual([]);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('products.json');
    expect(files[0]!.rows).toBe(2);
    expect(JSON.parse(files[0]!.json)).toEqual([
      { name: 'Cap', price: 120 },
      { name: 'Scarf', price: 80 },
    ]);
  });

  it('projects to fields= so a file carries only the columns the page needs', () => {
    const { files } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'products', fields: ['name', 'image'] }],
      entries: { products: [{ values: { name: 'Cap', price: 120, image: '/a.jpg', internalNote: 'do not ship' } }] },
      media: [],
    });
    expect(JSON.parse(files[0]!.json)).toEqual([{ name: 'Cap', image: '/a.jpg' }]);
    expect(files[0]!.json).not.toContain('do not ship');
  });

  it('emits PUBLISHED asset URLs for a FOLDER source, and registers them', () => {
    // ★ The defect this closes: without a resolver the file carries the CMS URL
    // (/media/<project>/<id>-<name>), which is a live route on platform hosting and does not exist on
    // a site exported to the owner's own server — that bundles media into a flat _assets/ directory
    // and produces only REFERENCED variants. Both failures hide behind a working platform preview.
    const registered: Array<{ id: string; size: string }> = [];
    const { files } = buildDataFiles({
      specs: [{ path: 'g.json', folder: 'gallery', size: 'sm' }],
      entries: {},
      media: [img({ url: '/media/p/a-1.jpg', folder: 'gallery', id: 'asset1' })],
      resolveAssetUrl: (asset, size) => {
        registered.push({ id: asset.id, size });
        return `_assets/AbC123-${asset.id}-${size}.webp`;
      },
    });
    expect(JSON.parse(files[0]!.json)[0].url).toBe('_assets/AbC123-asset1-sm.webp');
    // Registered for materialization, at the size the file references — else the export names files
    // it never produced.
    expect(registered).toEqual([{ id: 'asset1', size: 'sm' }]);
  });

  it('emits a SECOND `full` url when full= is declared, and registers that variant too', () => {
    // ★ A gallery needs two urls per image and one size cannot be both: the tile renders at a few
    // hundred pixels, the lightbox opens full-screen. Without this an author picks a soft viewer or a
    // grid that ships full-size photos to display them at 350px. Measured on a 3,384-image folder:
    // sm tiles 19 MB, md 58 MB, and the lg a viewer wants 133 MB — fetched one photo at a time.
    const registered: Array<{ id: string; size: string }> = [];
    const { files } = buildDataFiles({
      specs: [{ path: 'g.json', folder: 'gallery', size: 'sm', full: 'lg' }],
      entries: {},
      media: [img({ url: '/media/p/a-1.jpg', folder: 'gallery', id: 'a1', alt: 'A' })],
      resolveAssetUrl: (asset, size) => {
        registered.push({ id: asset.id, size });
        return `_assets/AbC-${asset.id}-${size}.webp`;
      },
    });
    expect(JSON.parse(files[0]!.json)[0]).toEqual({
      url: '_assets/AbC-a1-sm.webp',
      full: '_assets/AbC-a1-lg.webp',
      alt: 'A',
      width: 800,
      height: 600,
    });
    // BOTH variants registered — an unregistered `full` names a file the export never produces.
    expect(registered).toEqual([
      { id: 'a1', size: 'sm' },
      { id: 'a1', size: 'lg' },
    ]);
  });

  it('omits `full` entirely when it is not declared', () => {
    // Opt-in: emitting it always would silently double what every existing gallery materializes.
    const { files } = buildDataFiles({
      specs: [{ path: 'g.json', folder: 'gallery' }],
      entries: {},
      media: [img({ url: '/media/p/a-1.jpg', folder: 'gallery' })],
    });
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(files[0]!.json)[0], 'full')).toBe(false);
  });

  it('defaults the size to md', () => {
    const seen: string[] = [];
    buildDataFiles({
      specs: [{ path: 'g.json', folder: 'gallery' }],
      entries: {},
      media: [img({ url: '/media/p/a-1.jpg', folder: 'gallery', id: 'a' })],
      resolveAssetUrl: (_a, size) => { seen.push(size); return 'x'; },
    });
    expect(seen).toEqual(['md']);
  });

  it('rewrites media URLs inside DATASET rows, and registers those assets too', () => {
    // ★ The other half of the same defect. A product row carries `/media/…` in `image` exactly as a
    // folder listing does in `url`; fixing folders and leaving datasets fixes one half of one bug.
    const seen: string[] = [];
    const { files } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'products', size: 'sm' }],
      entries: { products: [{ values: { name: 'Cap', image: '/media/p/a-1.jpg', price: 120 } }] },
      media: [img({ url: '/media/p/a-1.jpg', folder: 'shop', id: 'asset1' })],
      resolveAssetUrl: (asset, size) => { seen.push(`${asset.id}:${size}`); return `_assets/AbC-${asset.id}-${size}.webp`; },
    });
    expect(JSON.parse(files[0]!.json)).toEqual([{ name: 'Cap', image: '_assets/AbC-asset1-sm.webp', price: 120 }]);
    expect(seen).toEqual(['asset1:sm']);
  });

  it('rewrites a media URL EMBEDDED in markup, not only a whole-value one', () => {
    const { files } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'posts' }],
      entries: { posts: [{ values: { body: '<p>See <img src="/media/p/a-1.jpg" alt="x"> here</p>' } }] },
      media: [img({ url: '/media/p/a-1.jpg', folder: 'x', id: 'a1' })],
      resolveAssetUrl: (asset) => `_assets/AbC-${asset.id}.webp`,
    });
    expect(JSON.parse(files[0]!.json)[0].body).toContain('src="_assets/AbC-a1.webp"');
    expect(files[0]!.json).not.toContain('/media/');
  });

  it('rewrites nested and array values', () => {
    const { files } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'd' }],
      entries: { d: [{ values: { gallery: ['/media/p/a-1.jpg'], meta: { hero: '/media/p/a-1.jpg' } } }] },
      media: [img({ url: '/media/p/a-1.jpg', folder: 'x', id: 'a1' })],
      resolveAssetUrl: () => '_assets/OK.webp',
    });
    expect(JSON.parse(files[0]!.json)[0]).toEqual({ gallery: ['_assets/OK.webp'], meta: { hero: '_assets/OK.webp' } });
  });

  it('leaves a look-alike string that is not a real asset alone', () => {
    // The map lookup decides, not the pattern — so prose mentioning a path can never be rewritten
    // into a URL the export does not contain.
    const { files } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'd' }],
      entries: { d: [{ values: { note: 'Upload it to /media/p/not-a-real-asset.jpg first.' } }] },
      media: [img({ url: '/media/p/a-1.jpg', folder: 'x', id: 'a1' })],
      resolveAssetUrl: () => '_assets/WRONG.webp',
    });
    expect(JSON.parse(files[0]!.json)[0].note).toContain('/media/p/not-a-real-asset.jpg');
  });

  it('emits a media folder as url/alt/width/height', () => {
    const { files } = buildDataFiles({
      specs: [{ path: 'gallery.json', folder: 'gallery' }],
      entries: {},
      media: [
        img({ url: '/media/p/a-1.jpg', folder: 'gallery', alt: 'A' }),
        img({ url: '/media/p/b-2.jpg', folder: 'other' }),
      ],
    });
    expect(JSON.parse(files[0]!.json)).toEqual([{ url: '/media/p/a-1.jpg', alt: 'A', width: 800, height: 600 }]);
  });

  it('ignores non-image assets in the folder', () => {
    const pdf = { kind: 'file', id: 'd', filename: 'a.pdf', folder: 'gallery', bytes: 10, url: '/media/p/d-a.pdf' } as unknown as MediaAsset;
    const { files } = buildDataFiles({
      specs: [{ path: 'g.json', folder: 'gallery' }],
      entries: {},
      media: [pdf, img({ url: '/media/p/a-1.jpg', folder: 'gallery' })],
    });
    expect(JSON.parse(files[0]!.json)).toHaveLength(1);
  });

  // ── the silent failures ──
  it('WARNS when a dataset source resolves to nothing, and still emits an empty list', () => {
    const { files, warnings } = buildDataFiles({
      specs: [{ path: 'p.json', dataset: 'nope' }],
      entries: { products: [{ values: { name: 'Cap' } }] },
      media: [],
    });
    // The file still exists: a client that fetches it gets a valid empty list rather than a 404 it has
    // to special-case. The WARNING is what tells the author the list is empty on purpose or by mistake.
    expect(files[0]!.json).toBe('[]');
    expect(warnings[0]).toContain('dataset "nope" has no published entries');
  });

  it('WARNS when a media folder resolves to nothing', () => {
    const { warnings } = buildDataFiles({ specs: [{ path: 'g.json', folder: 'missing' }], entries: {}, media: [] });
    expect(warnings[0]).toContain('media folder "missing" has no images');
  });

  it('refuses a duplicate path instead of letting array order decide', () => {
    const { files, warnings } = buildDataFiles({
      specs: [
        { path: 'x.json', dataset: 'a' },
        { path: 'x.json', dataset: 'b' },
      ],
      entries: { a: [{ values: { n: 1 } }], b: [{ values: { n: 2 } }] },
      media: [],
    });
    expect(files).toHaveLength(1);
    expect(JSON.parse(files[0]!.json)).toEqual([{ n: 1 }]);
    expect(warnings.some((w) => w.includes('declared more than once'))).toBe(true);
  });

  it('refuses an oversized file LOUDLY rather than truncating it', () => {
    const big = Array.from({ length: 60_000 }, (_, i) => ({ values: { blob: `${i}`.padEnd(80, 'x') } }));
    const { files, warnings } = buildDataFiles({
      specs: [{ path: 'big.json', dataset: 'big' }],
      entries: { big },
      media: [],
    });
    expect(files).toHaveLength(0);
    expect(warnings[0]).toContain(`over the ${MAX_DATA_FILE_BYTES}-byte limit`);
  });

  it('is prototype-safe about the dataset name', () => {
    // `entries` is a plain record keyed by author-supplied names; a lookup must not walk the prototype
    // and hand back Object.prototype members as if they were rows.
    const { files, warnings } = buildDataFiles({
      specs: [{ path: 'x.json', dataset: 'constructor' }],
      entries: { products: [{ values: { n: 1 } }] },
      media: [],
    });
    expect(files[0]!.json).toBe('[]');
    expect(warnings[0]).toContain('has no published entries');
  });
});
