import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '@sitewright/schema';
import { PreviewEncodeLane } from '../src/http/preview-encode-lane.js';
import { collectThumbRefs, encodeEstimateBytes, type ThumbRefs } from '../src/publish/media-thumbs.js';

const image = (id: string, width = 2400, height = 1600): MediaAsset =>
  ({ id, kind: 'image', original: `${id}.jpg`, width, height }) as unknown as MediaAsset;
const refs = (entries: Record<string, string[]>): ThumbRefs =>
  new Map(Object.entries(entries).map(([id, thumbs]) => [id, { thumbs: new Set(thumbs), original: false }]));

describe('PreviewEncodeLane — the variants a member just previewed', () => {
  it('opens exactly the referenced variants of the project’s own images, with their encode estimate', () => {
    const lane = new PreviewEncodeLane();
    lane.allow('acme', refs({ a1: ['md:webp', 'sm:avif'] }), [image('a1')]);
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBe(encodeEstimateBytes(2400, 1600));
    expect(lane.estimate('acme', 'a1', 'sm', 'avif')).toBeDefined();
    // Another size of the same image, another project, another image: all closed.
    expect(lane.estimate('acme', 'a1', 'xl', 'webp')).toBeUndefined();
    expect(lane.estimate('other', 'a1', 'md', 'webp')).toBeUndefined();
    expect(lane.estimate('acme', 'a2', 'md', 'webp')).toBeUndefined();
  });

  it('ignores ids that are not one of the project’s images', () => {
    const lane = new PreviewEncodeLane();
    const font = { id: 'f1', kind: 'font', original: 'f1.woff2' } as unknown as MediaAsset;
    lane.allow('acme', refs({ f1: ['md:webp'], ghost: ['md:webp'] }), [font]);
    expect(lane.estimate('acme', 'f1', 'md', 'webp')).toBeUndefined();
    expect(lane.estimate('acme', 'ghost', 'md', 'webp')).toBeUndefined();
  });

  it('closes after its time, and a new preview reopens it', () => {
    let now = 1_000;
    const lane = new PreviewEncodeLane(60_000, 100, 1_000, () => now);
    lane.allow('acme', refs({ a1: ['md:webp'] }), [image('a1')]);
    now += 59_999;
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBeDefined();
    now += 1;
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBeUndefined();
    lane.allow('acme', refs({ a1: ['md:webp'] }), [image('a1')]);
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBeDefined();
  });

  it('a later preview keeps the earlier page’s variants open beside its own', () => {
    const lane = new PreviewEncodeLane();
    lane.allow('acme', refs({ a1: ['md:webp'] }), [image('a1'), image('a2')]);
    lane.allow('acme', refs({ a2: ['lg:webp'] }), [image('a1'), image('a2')]);
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBeDefined();
    expect(lane.estimate('acme', 'a2', 'lg', 'webp')).toBeDefined();
  });

  it('holds at most its bound per project, keeping the newest variants', () => {
    const lane = new PreviewEncodeLane(60_000, 2, 1_000);
    const media = [image('a1'), image('a2'), image('a3')];
    lane.allow('acme', refs({ a1: ['md:webp'], a2: ['md:webp'] }), media);
    lane.allow('acme', refs({ a3: ['md:webp'] }), media);
    expect(lane.estimate('acme', 'a1', 'md', 'webp')).toBeUndefined();
    expect(lane.estimate('acme', 'a2', 'md', 'webp')).toBeDefined();
    expect(lane.estimate('acme', 'a3', 'md', 'webp')).toBeDefined();
  });

  it('holds at most its bound across projects, letting the least recently previewed go first', () => {
    const lane = new PreviewEncodeLane(60_000, 10, 3);
    lane.allow('one', refs({ a: ['md:webp', 'sm:webp'] }), [image('a')]);
    lane.allow('two', refs({ b: ['md:webp'] }), [image('b')]);
    lane.allow('one', refs({ a: ['md:webp'] }), [image('a')]); // previewed again: now the most recent
    lane.allow('three', refs({ c: ['md:webp'] }), [image('c')]);
    expect(lane.estimate('two', 'b', 'md', 'webp')).toBeUndefined();
    expect(lane.estimate('one', 'a', 'md', 'webp')).toBeDefined();
    expect(lane.estimate('three', 'c', 'md', 'webp')).toBeDefined();
  });

  it('reads a rendered page’s variants exactly as the build does: srcset rungs, AVIF sources, bare = xl WebP', () => {
    const html =
      '<img src="/media/acme/a1-photo.jpg?size=xl" srcset="/media/acme/a1-photo.jpg?size=sm 640w, /media/acme/a1-photo.jpg?size=md 1024w">' +
      '<picture><source type="image/avif" srcset="/media/acme/a2-hero.jpg?size=lg&amp;format=avif 1600w"><img src="/media/acme/a2-hero.jpg"></picture>' +
      '<div style="background-image:url(/media/acme/a3-bg.png?size=md)"></div>' +
      // Not this project's delivery route: another project, an absolute URL, an SVG.
      '<img src="/media/other/b1-x.jpg?size=md"><img src="https://cdn.example.test/media/acme/a4-y.jpg?size=md"><img src="/media/acme/a5-logo.svg">';
    const got = collectThumbRefs(html, 'acme');
    expect([...got.get('a1')!.thumbs].sort()).toEqual(['md:webp', 'sm:webp', 'xl:webp']);
    expect([...got.get('a2')!.thumbs].sort()).toEqual(['lg:avif', 'xl:webp']);
    expect([...got.get('a3')!.thumbs]).toEqual(['md:webp']);
    expect(got.has('b1')).toBe(false);
    expect(got.has('a4')).toBe(false);
    expect(got.get('a5')?.thumbs.size ?? 0).toBe(0);
  });
});
