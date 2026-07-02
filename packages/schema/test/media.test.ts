import { describe, it, expect } from 'vitest';
import { MediaAssetSchema, ImageAssetSchema, FileAssetSchema, FontAssetSchema } from '../src/media.js';

const fontBase = {
  kind: 'font' as const,
  id: 'fa1b2c3d',
  filename: 'Playfair Display',
  bytes: 23000,
  family: 'Playfair Display',
  fallback: 'serif' as const,
  source: 'google' as const,
  files: [{ weight: 400 as const, format: 'woff2' as const, file: '400.woff2' }, { weight: 700 as const, format: 'woff2' as const, file: '700.woff2' }],
  url: '/media/proj1/fa1b2c3d/400.woff2',
};

const imageBase = {
  kind: 'image' as const,
  id: 'a1b2c3d4',
  filename: 'hero.png',
  bytes: 1234,
  format: 'png',
  width: 800,
  height: 600,
  hasAlpha: false,
  animated: false,
  original: 'hero.png',
  url: '/media/proj1/a1b2c3d4/hero.png',
};

const fileBase = {
  kind: 'file' as const,
  id: 'f1f2f3f4',
  filename: 'brochure.pdf',
  bytes: 99999,
  contentType: 'application/pdf',
  storedName: 'brochure.pdf',
  url: '/media/proj1/f1f2f3f4/file/brochure.pdf',
};

describe('MediaAssetSchema (image | file discriminated union)', () => {
  it('parses an image asset and defaults folder to root', () => {
    const a = MediaAssetSchema.parse(imageBase);
    expect(a.kind).toBe('image');
    expect(a.folder).toBe('');
    if (a.kind === 'image') expect(a.original).toBe('hero.png');
  });

  it('parses a file asset with a folder', () => {
    const a = MediaAssetSchema.parse({ ...fileBase, folder: 'Docs/2026' });
    expect(a.kind).toBe('file');
    expect(a.folder).toBe('Docs/2026');
    if (a.kind === 'file') expect(a.storedName).toBe('brochure.pdf');
  });

  it('rejects a folder with a leading slash or traversal', () => {
    expect(() => MediaAssetSchema.parse({ ...fileBase, folder: '/abs' })).toThrow();
    expect(() => MediaAssetSchema.parse({ ...fileBase, folder: '../up' })).toThrow();
    expect(() => MediaAssetSchema.parse({ ...fileBase, folder: 'a//b' })).toThrow();
  });

  it('rejects an image url with a non-image extension', () => {
    expect(() => ImageAssetSchema.parse({ ...imageBase, url: '/media/p/a/x.exe' })).toThrow();
  });

  it('rejects a file url that is not routed through the /file/ attachment handler', () => {
    expect(() => FileAssetSchema.parse({ ...fileBase, url: '/media/proj1/f1f2f3f4/brochure.pdf' })).toThrow();
  });

  it('rejects a stored file name with path separators', () => {
    expect(() => FileAssetSchema.parse({ ...fileBase, storedName: 'a/b.pdf' })).toThrow();
    expect(() => FileAssetSchema.parse({ ...fileBase, storedName: '../b.pdf' })).toThrow();
  });

  it('parses a font asset (family + files) in the union', () => {
    const a = MediaAssetSchema.parse({ ...fontBase, folder: 'Brand' });
    expect(a.kind).toBe('font');
    if (a.kind === 'font') {
      expect(a.family).toBe('Playfair Display');
      expect(a.files).toHaveLength(2);
      expect(a.files[0]).toEqual({ weight: 400, style: 'normal', format: 'woff2', file: '400.woff2' });
    }
  });

  it('rejects a font url that is not a self-hosted face path, and a non-font fallback', () => {
    expect(() => FontAssetSchema.parse({ ...fontBase, url: '/media/proj1/fa1b2c3d/file/x.pdf' })).toThrow();
    expect(() => FontAssetSchema.parse({ ...fontBase, fallback: 'fantasy' })).toThrow();
    expect(() => FontAssetSchema.parse({ ...fontBase, files: [] })).toThrow();
  });

  it('accepts the slugged font file scheme `<family-slug>-<weight>[-italic].<ext>` (legacy un-slugged still valid)', () => {
    const slugged = {
      ...fontBase,
      files: [
        { weight: 400 as const, format: 'woff2' as const, file: 'playfair-display-400.woff2' },
        { weight: 700 as const, style: 'italic' as const, format: 'woff2' as const, file: 'playfair-display-700-italic.woff2' },
      ],
      url: '/media/proj1/fa1b2c3d/playfair-display-400.woff2',
    };
    const a = FontAssetSchema.parse(slugged);
    expect(a.files[1]!.file).toBe('playfair-display-700-italic.woff2');
    // The pre-change `<weight>.<ext>` scheme still validates (back-compat for already-stored fonts).
    expect(() => FontAssetSchema.parse(fontBase)).not.toThrow();
    // A path-unsafe filename is still rejected.
    expect(() => FontAssetSchema.parse({ ...slugged, files: [{ weight: 400 as const, format: 'woff2' as const, file: '../evil.woff2' }] })).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => MediaAssetSchema.parse({ ...imageBase, kind: 'video' })).toThrow();
  });
});
