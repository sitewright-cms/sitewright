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
