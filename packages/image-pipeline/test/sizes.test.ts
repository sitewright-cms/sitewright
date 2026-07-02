import { describe, it, expect } from 'vitest';
import {
  THUMB_SIZES,
  SIZE_TOKENS,
  DEFAULT_SIZE,
  isSizeToken,
  isThumbFormat,
  isThumbnailable,
  thumbFileName,
} from '../src/sizes.js';

describe('sizes', () => {
  it('exposes the named responsive width set (sm/md/lg/xl)', () => {
    expect(THUMB_SIZES).toEqual({ sm: 500, md: 1000, lg: 1600, xl: 2400 });
    expect(SIZE_TOKENS).toEqual(['sm', 'md', 'lg', 'xl']);
  });

  it('defaults the delivery route to xl (compressed, never the uncapped original)', () => {
    expect(DEFAULT_SIZE).toBe('xl');
  });

  it('guards size tokens and formats', () => {
    expect(isSizeToken('lg')).toBe(true);
    expect(isSizeToken('xxl')).toBe(false);
    expect(isSizeToken('original')).toBe(false); // handled separately, not a thumbnail size
    expect(isThumbFormat('webp')).toBe(true);
    expect(isThumbFormat('avif')).toBe(true);
    expect(isThumbFormat('jpg')).toBe(false);
  });

  it('recognises thumbnailable raster extensions (never SVG)', () => {
    expect(isThumbnailable('photo.jpg')).toBe(true);
    expect(isThumbnailable('photo.PNG')).toBe(true);
    expect(isThumbnailable('anim.gif')).toBe(true);
    expect(isThumbnailable('logo.svg')).toBe(false);
    expect(isThumbnailable('doc.pdf')).toBe(false);
    expect(isThumbnailable('font.woff2')).toBe(false);
    expect(isThumbnailable('noext')).toBe(false);
  });

  it('builds a single-extension thumbnail file name (stem-size.format, no interior dot)', () => {
    expect(thumbFileName('photo.jpg', 'xl', 'webp')).toBe('photo-xl.webp');
    expect(thumbFileName('hero-image.png', 'sm', 'avif')).toBe('hero-image-sm.avif');
    // matches the media serve route's SERVABLE_FILE charset: [A-Za-z0-9_-]+\.(avif|webp|jpg)
    expect(thumbFileName('photo.jpg', 'xl', 'webp')).toMatch(/^[A-Za-z0-9_-]+\.(avif|webp|jpg)$/);
  });
});
