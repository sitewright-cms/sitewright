import { describe, it, expect } from 'vitest';
import type { MediaAsset } from '@sitewright/schema';
import { __icons } from '../src/views/media/file-icons';

const { assetExt, categoryForExt, categoryForKind, CATEGORIES } = __icons;

/** The category name (`image`/`font`/`css`/…) an ext resolves to, for readable assertions. */
function catName(ext: string): string {
  const cat = categoryForExt(ext);
  return Object.entries(CATEGORIES).find(([, c]) => c === cat)?.[0] ?? 'generic';
}

const base = { id: 'x', filename: 'DISPLAY NAME WITHOUT EXTENSION', folder: '', bytes: 1 };

describe('assetExt — the REAL stored extension, never the display name', () => {
  it('reads a non-image file from its storedName, not its (renamed, extension-less) filename', () => {
    const mp4: MediaAsset = { ...base, kind: 'file', contentType: 'video/mp4', storedName: 'clip.mp4', url: '/media/a/x-clip.mp4' };
    expect(assetExt(mp4)).toBe('mp4');
    expect(catName(assetExt(mp4))).toBe('video');
  });

  it('maps a font by its file format regardless of a bare family display name', () => {
    const font: MediaAsset = {
      ...base, kind: 'font', family: 'Inter', fallback: 'sans-serif', source: 'google',
      files: [{ weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' }],
      url: '/media/a/x-inter-400.woff2',
    };
    expect(assetExt(font)).toBe('woff2');
    expect(catName(assetExt(font))).toBe('font');
  });

  it('maps a stylesheet asset to css and a script asset to js by kind', () => {
    const css: MediaAsset = { ...base, kind: 'stylesheet', storedName: 'styles.css', url: '/media/a/x-styles.css' };
    const js: MediaAsset = { ...base, kind: 'script', storedName: 'app.js', url: '/media/a/x-app.js' };
    expect(catName(assetExt(css))).toBe('css');
    expect(catName(assetExt(js))).toBe('js');
  });

  it('normalizes an image jpeg format to the jpg extension', () => {
    const jpg: MediaAsset = {
      ...base, kind: 'image', format: 'jpeg', width: 10, height: 10, hasAlpha: false, animated: false,
      original: 'p.jpg', url: '/media/a/x-p.jpg',
    };
    expect(assetExt(jpg)).toBe('jpg');
    expect(catName(assetExt(jpg))).toBe('image');
  });
});

describe('categoryForExt — coverage for common web filetypes', () => {
  it('distinguishes css, js and generic code', () => {
    expect(catName('css')).toBe('css');
    expect(catName('scss')).toBe('css');
    expect(catName('js')).toBe('js');
    expect(catName('mjs')).toBe('js');
    expect(catName('json')).toBe('code');
    expect(catName('html')).toBe('code');
  });

  it('recognises pdf, fonts, audio, video and archives', () => {
    expect(catName('pdf')).toBe('pdf');
    expect(catName('woff2')).toBe('font');
    expect(catName('otf')).toBe('font');
    expect(catName('mp3')).toBe('audio');
    expect(catName('mp4')).toBe('video');
    expect(catName('webm')).toBe('video');
    expect(catName('zip')).toBe('archive');
  });

  it('falls back to the generic page icon for an unknown extension', () => {
    expect(catName('xyz')).toBe('generic');
    expect(catName('')).toBe('generic');
  });
});

describe('categoryForKind — the no-asset fallback (kind implies a category without an extension)', () => {
  const nameOf = (cat: ReturnType<typeof categoryForKind>) =>
    cat ? Object.entries(CATEGORIES).find(([, c]) => c === cat)?.[0] : undefined;

  it('maps font/stylesheet/script/image kinds to a category with no extension', () => {
    expect(nameOf(categoryForKind('font'))).toBe('font');
    expect(nameOf(categoryForKind('stylesheet'))).toBe('css');
    expect(nameOf(categoryForKind('script'))).toBe('js');
    expect(nameOf(categoryForKind('image'))).toBe('image');
  });

  it('returns undefined for a plain file kind (must sniff the extension instead)', () => {
    expect(categoryForKind('file')).toBeUndefined();
  });
});
