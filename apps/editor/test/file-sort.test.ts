import { describe, it, expect } from 'vitest';
import type { MediaAsset } from '@sitewright/schema';
import { sortAssets, sortFolders, folderBytes, matchesName, type FolderEntry } from '../src/views/files/sort';

const img = (over: Partial<MediaAsset>): MediaAsset =>
  ({ kind: 'image', id: 'i', filename: 'a.png', folder: '', bytes: 10, format: 'image/png', width: 1, height: 1, variants: [], fallback: 'a.jpg', url: '/m/a.jpg', ...over }) as MediaAsset;
const doc = (over: Partial<MediaAsset>): MediaAsset =>
  ({ kind: 'file', id: 'f', filename: 'a.pdf', folder: '', bytes: 10, contentType: 'application/pdf', storedName: 'a.pdf', url: '/m/a.pdf', ...over }) as MediaAsset;

describe('media sort helpers', () => {
  const a = img({ id: '1', filename: 'banana.png', bytes: 300 });
  const b = img({ id: '2', filename: 'apple.png', bytes: 100 });
  const c = doc({ id: '3', filename: 'cherry.pdf', bytes: 200 });

  it('sorts by name, ascending and descending', () => {
    expect(sortAssets([a, b, c], { key: 'name', dir: 'asc' }).map((x) => x.filename)).toEqual(['apple.png', 'banana.png', 'cherry.pdf']);
    expect(sortAssets([a, b, c], { key: 'name', dir: 'desc' }).map((x) => x.filename)).toEqual(['cherry.pdf', 'banana.png', 'apple.png']);
  });

  it('sorts by size, ascending and descending', () => {
    expect(sortAssets([a, b, c], { key: 'size', dir: 'asc' }).map((x) => x.bytes)).toEqual([100, 200, 300]);
    expect(sortAssets([a, b, c], { key: 'size', dir: 'desc' }).map((x) => x.bytes)).toEqual([300, 200, 100]);
  });

  it('sorts by type with the filename as the tiebreaker', () => {
    // 'application/pdf' (the file) < 'image/png' (the images); the two images tie → name order.
    expect(sortAssets([a, b, c], { key: 'type', dir: 'asc' }).map((x) => x.filename)).toEqual(['cherry.pdf', 'apple.png', 'banana.png']);
  });

  it('does not mutate its input', () => {
    const input = [a, b, c];
    sortAssets(input, { key: 'size', dir: 'asc' });
    expect(input.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('folderBytes sums direct + descendant assets only', () => {
    const assets = [doc({ folder: 'Docs', bytes: 100 }), doc({ folder: 'Docs/Sub', bytes: 50 }), doc({ folder: 'Other', bytes: 999 })];
    expect(folderBytes(assets, 'Docs')).toBe(150);
    expect(folderBytes(assets, 'Other')).toBe(999);
    expect(folderBytes(assets, 'Missing')).toBe(0);
  });

  it('sortFolders orders by size or by name (folders never sort by type)', () => {
    const fe: FolderEntry[] = [
      { seg: 'B', path: 'B', bytes: 200 },
      { seg: 'A', path: 'A', bytes: 100 },
    ];
    expect(sortFolders(fe, { key: 'name', dir: 'asc' }).map((f) => f.seg)).toEqual(['A', 'B']);
    expect(sortFolders(fe, { key: 'size', dir: 'desc' }).map((f) => f.seg)).toEqual(['B', 'A']);
    expect(sortFolders(fe, { key: 'type', dir: 'asc' }).map((f) => f.seg)).toEqual(['A', 'B']); // type → name
  });

  it('matchesName is a case-insensitive substring; a blank query matches everything', () => {
    expect(matchesName('AP', 'apple.png')).toBe(true);
    expect(matchesName('xyz', 'apple.png')).toBe(false);
    expect(matchesName('   ', 'anything')).toBe(true);
  });
});
