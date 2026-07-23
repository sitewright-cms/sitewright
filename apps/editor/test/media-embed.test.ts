import { describe, it, expect } from 'vitest';
import type { MediaAsset } from '@sitewright/schema';
import { assetEmbedUrls } from '../src/views/files/media-embed';

const image: MediaAsset = {
  kind: 'image',
  id: 'img1',
  filename: 'hero.png',
  folder: '',
  bytes: 2048,
  format: 'png',
  width: 3000,
  height: 2000,
  hasAlpha: false,
  animated: false,
  original: 'hero.png',
  url: '/media/acme/img1-hero.png',
};

const pdf: MediaAsset = {
  kind: 'file',
  id: 'f1',
  filename: 'Brochure',
  folder: '',
  bytes: 1024,
  contentType: 'application/pdf',
  storedName: 'brochure.pdf',
  url: '/media/acme/f1-brochure.pdf',
};

const font: MediaAsset = {
  kind: 'font',
  id: 'ft1',
  filename: 'Inter',
  folder: '',
  bytes: 4096,
  family: 'Inter',
  fallback: 'sans-serif',
  source: 'google',
  files: [{ weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' }],
  url: '/media/acme/ft1-inter-400.woff2',
};

describe('assetEmbedUrls', () => {
  it('gives a non-image file a single root-relative URL', () => {
    const urls = assetEmbedUrls(pdf);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatchObject({ label: 'URL', url: '/media/acme/f1-brochure.pdf' });
    expect(urls[0]!.hint).toContain('application/pdf');
  });

  it('gives a font a single URL hinted with its family', () => {
    const urls = assetEmbedUrls(font);
    expect(urls).toHaveLength(1);
    expect(urls[0]!.url).toBe('/media/acme/ft1-inter-400.woff2');
    expect(urls[0]!.hint).toContain('Inter');
  });

  it('gives a raster image the default URL, the original, and thumbnail sizes', () => {
    const urls = assetEmbedUrls(image);
    // Size LABELS are uppercase (SM/MD/LG/XL) for display; the `?size=` token stays lowercase.
    expect(urls.map((u) => u.label)).toEqual(['URL', 'Original', 'SM', 'MD', 'LG', 'XL']);
    expect(urls.find((u) => u.label === 'URL')?.url).toBe('/media/acme/img1-hero.png');
    expect(urls.find((u) => u.label === 'Original')?.url).toBe('/media/acme/img1-hero.png?size=original');
    expect(urls.find((u) => u.label === 'LG')?.url).toBe('/media/acme/img1-hero.png?size=lg');
  });

  it('never offers an upscaled thumbnail: a small source stops at the first rung reaching its width', () => {
    const small: MediaAsset = { ...image, width: 400, height: 300 };
    const urls = assetEmbedUrls(small);
    // sm (500) already >= the 400px source, so no md/lg/xl are offered.
    expect(urls.map((u) => u.label)).toEqual(['URL', 'Original', 'SM']);
    expect(urls.find((u) => u.label === 'SM')?.hint).toBe('400px wide'); // clamped to the source
  });

  it('gives an SVG a single URL (a vector has no rasterized thumbnails)', () => {
    const svg: MediaAsset = { ...image, id: 's1', format: 'svg', original: 'logo.svg', url: '/media/acme/s1-logo.svg' };
    const urls = assetEmbedUrls(svg);
    expect(urls).toHaveLength(1);
    expect(urls[0]!.url).toBe('/media/acme/s1-logo.svg');
    expect(urls[0]!.hint).toContain('vector');
  });
});
