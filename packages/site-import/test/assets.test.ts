import { describe, expect, it, vi } from 'vitest';
import { parse } from '../src/dom.js';
import { collectImageRefs, hostAssets } from '../src/transform/assets.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { CapturedSite, MediaPort } from '../src/types.js';

function emptySite(assets = new Map()): CapturedSite {
  return { baseUrl: 'https://ex.com/', pages: [], assets, origin: { kind: 'crawl', label: 'x' } };
}

describe('collectImageRefs', () => {
  it('collects images from img/srcset, source, video poster, og:image, icon and background-image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://ex.com/og.jpg">
      <link rel="icon" href="/favicon.png">
      </head><body>
      <img src="/a.png" srcset="/a.png 1x, /a-2x.png 2x">
      <picture><source srcset="/b.webp 800w"></picture>
      <video poster="/poster.jpg"></video>
      <div style="background-image:url('/bg.jpg')"></div>
      </body></html>`;
    const refs = collectImageRefs([{ url: 'https://ex.com/p', doc: parse(html) }], emptySite());
    const keys = [...refs.keys()].sort();
    expect(keys).toContain('https://ex.com/a.png');
    expect(keys).toContain('https://ex.com/a-2x.png');
    expect(keys).toContain('https://ex.com/b.webp');
    expect(keys).toContain('https://ex.com/poster.jpg');
    expect(keys).toContain('https://ex.com/og.jpg');
    expect(keys).toContain('https://ex.com/favicon.png');
    expect(keys).toContain('https://ex.com/bg.jpg');
  });

  it('prefers a captured asset (with bytes) over a synthesized remote ref', () => {
    const captured = { sourceRef: 'https://ex.com/a.png', kind: 'image' as const, bytes: new Uint8Array([1, 2, 3]) };
    const refs = collectImageRefs([{ url: 'https://ex.com/p', doc: parse('<img src="/a.png">') }], emptySite(new Map([['https://ex.com/a.png', captured]])));
    expect(refs.get('https://ex.com/a.png')).toBe(captured);
  });
});

describe('hostAssets', () => {
  const refs = () => new Map([
    ['https://ex.com/a.png', { sourceRef: 'a', kind: 'image' as const, remoteUrl: 'https://ex.com/a.png' }],
    ['https://ex.com/b.png', { sourceRef: 'b', kind: 'image' as const, remoteUrl: 'https://ex.com/b.png' }],
  ]);

  it('hosts every asset and reports progress', async () => {
    const onProgress = vi.fn();
    const media: MediaPort = { hostAsset: async (a) => ({ ref: `/media/${a.sourceRef}.jpg` }) };
    const res = await hostAssets(refs(), media, DEFAULT_LIMITS, onProgress);
    expect(res.hosted).toBe(2);
    expect(res.assetMap.get('https://ex.com/a.png')).toBe('/media/a.jpg');
    expect(onProgress).toHaveBeenCalled();
  });

  it('records a diagnostic when a host returns null or throws', async () => {
    const media: MediaPort = {
      hostAsset: async (a) => {
        if (a.sourceRef === 'a') return null;
        throw new Error('boom');
      },
    };
    const res = await hostAssets(refs(), media, DEFAULT_LIMITS);
    expect(res.hosted).toBe(0);
    expect(res.diagnostics.filter((d) => d.code === 'image-host-failed')).toHaveLength(2);
  });

  it('respects the image budget', async () => {
    const media: MediaPort = { hostAsset: async (a) => ({ ref: `/media/${a.sourceRef}.jpg` }) };
    const res = await hostAssets(refs(), media, { ...DEFAULT_LIMITS, maxImages: 1 });
    expect(res.hosted).toBe(1);
    expect(res.diagnostics.some((d) => d.code === 'image-budget-exceeded')).toBe(true);
  });
});
