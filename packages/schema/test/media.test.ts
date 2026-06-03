import { describe, it, expect } from 'vitest';
import { MediaAssetSchema, ImageAssetSchema, FileAssetSchema } from '../src/media.js';

const imageBase = {
  kind: 'image' as const,
  id: 'a1b2c3d4',
  filename: 'hero.png',
  bytes: 1234,
  format: 'png',
  width: 800,
  height: 600,
  variants: [{ format: 'avif' as const, width: 800, height: 600, path: 'hero-800.avif' }],
  fallback: 'hero-800.jpg',
  url: '/media/proj1/a1b2c3d4/hero-800.jpg',
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
    if (a.kind === 'image') expect(a.variants.length).toBe(1);
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

  it('rejects an unknown kind', () => {
    expect(() => MediaAssetSchema.parse({ ...imageBase, kind: 'video' })).toThrow();
  });
});
