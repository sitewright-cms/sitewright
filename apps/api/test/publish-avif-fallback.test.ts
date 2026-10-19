import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import type { MediaAsset } from '@sitewright/schema';
import { buildSite } from '../src/publish/build.js';
import { analyzeImageSizing, extractImageRefs } from '../src/render/image-sizing.js';

// ★ AVIF DELIVERY MUST NOT SHIP AN OVERSIZED FALLBACK.
//
// `{{sw-image … format="avif"}}` (or site-wide `imageDelivery: 'avif'`) wraps the image in a <picture>. Its
// fallback <img> got the LARGEST rung as a bare `src` — the ~2400px file — with no srcset/sizes, so the sizing
// check behind `pagespeed_audit` flagged every AVIF image as oversized and agents avoided AVIF altogether.
// Measured the way the audit measures it: on the BUILT page, where each rung is a flat `…-<rung>.webp` file.

const HERO: Extract<MediaAsset, { kind: 'image' }> = {
  kind: 'image',
  id: 'h1',
  folder: '',
  filename: 'hero.png',
  format: 'png',
  bytes: 1,
  width: 2400,
  height: 1200,
  hasAlpha: false,
  animated: false,
  original: 'hero.png',
  url: '/media/acme/h1-hero.png',
};

let outDir = '';
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-avif-fallback-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

async function publish(source: string, website?: Record<string, unknown>): Promise<string> {
  await buildSite({
    publishedAt: '2026-10-19T00:00:00.000Z',
    outDir,
    media: [HERO],
    bundle: {
      project: {
        formatVersion: 2 as const,
        id: 'p',
        name: 'Acme',
        slug: 'acme',
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
        ...(website ? { website } : {}),
      },
      pages: [{ id: 'home', path: '', title: 'Home', source }],
      datasets: [],
      entries: [],
    } as unknown as ProjectBundle,
  });
  return readFile(join(outDir, 'index.html'), 'utf8');
}

describe('publish — {{sw-image}} AVIF fallback', () => {
  for (const [name, source, website] of [
    ['format="avif" on the helper', `<section>{{sw-image "${HERO.url}" alt="Hero" format="avif"}}</section>`, undefined],
    ['site-wide imageDelivery avif', `<section>{{sw-image "${HERO.url}" alt="Hero"}}</section>`, { imageDelivery: 'avif' }],
  ] as const) {
    it(`★ ${name}: the fallback <img> carries the srcset, and the sizing audit has nothing to flag`, async () => {
      const home = await publish(source, website);
      expect(home).toContain('<source type="image/avif"'); // presence guard: this IS the AVIF <picture>
      const fallback = home.match(/<picture>[\s\S]*?(<img\b[^>]*>)[\s\S]*?<\/picture>/)?.[1];
      expect(fallback).toBeDefined();
      expect(fallback).toMatch(/srcset="_assets\/[^"]*-sm\.webp 500w, [^"]*-md\.webp 1000w, [^"]*-lg\.webp 1600w, [^"]*-xl\.webp 2400w"/);
      expect(fallback).toContain('sizes="100vw"');
      const report = analyzeImageSizing(extractImageRefs(home));
      expect(report.findings).toEqual([]);
    });
  }
});
