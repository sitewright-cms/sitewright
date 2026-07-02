import { describe, it, expect } from 'vitest';
import type { MediaAsset } from '@sitewright/schema';
import { derivedThumbnailNames, buildThumbSkipMap } from '../src/export/thumb-skip.js';

function imageAsset(id: string, original: string): MediaAsset {
  return {
    kind: 'image',
    id,
    filename: `${original}`,
    folder: '',
    bytes: 10,
    format: 'png',
    width: 100,
    height: 80,
    hasAlpha: false,
    animated: false,
    original,
    url: `/media/site/${id}/${original}`,
  } as MediaAsset;
}

describe('derivedThumbnailNames', () => {
  it('enumerates the 8 cacheable thumbnail names (sizes × formats) for an image', () => {
    const names = derivedThumbnailNames(imageAsset('a', 'photo.png'));
    expect([...names].sort()).toEqual(
      [
        'photo-sm.webp',
        'photo-md.webp',
        'photo-lg.webp',
        'photo-xl.webp',
        'photo-sm.avif',
        'photo-md.avif',
        'photo-lg.avif',
        'photo-xl.avif',
      ].sort(),
    );
    // The retained original is NEVER in its own skip set → always exported.
    expect(names.has('photo.png')).toBe(false);
  });

  it('does NOT misclassify an original literally named like a thumbnail (no data loss)', () => {
    // A user upload named `foo-xl.webp`: its own thumbnails are `foo-xl-<size>.<fmt>`, so the
    // original is never in the skip set and always ships.
    const names = derivedThumbnailNames(imageAsset('b', 'foo-xl.webp'));
    expect(names.has('foo-xl.webp')).toBe(false);
    expect(names.has('foo-xl-xl.webp')).toBe(true);
  });

  it('returns an empty set for a non-image asset (no thumbnails)', () => {
    const file = { kind: 'file', id: 'f', storedName: 'doc.pdf' } as unknown as MediaAsset;
    expect(derivedThumbnailNames(file).size).toBe(0);
  });
});

describe('buildThumbSkipMap', () => {
  it('maps only image asset ids to their thumbnail names', () => {
    const media: MediaAsset[] = [
      imageAsset('img', 'a.png'),
      { kind: 'file', id: 'doc', storedName: 'x.pdf' } as unknown as MediaAsset,
    ];
    const map = buildThumbSkipMap(media);
    expect([...map.keys()]).toEqual(['img']);
    expect(map.get('img')!.has('a-xl.webp')).toBe(true);
    expect(map.has('doc')).toBe(false);
  });
});
