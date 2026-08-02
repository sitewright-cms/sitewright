import { describe, expect, it, vi } from 'vitest';
import { parse } from '../src/dom.js';
import { collectDocumentRefs, collectImageRefs, collectUnhostableMedia, hostAssets } from '../src/transform/assets.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { CapturedSite, MediaPort } from '../src/types.js';

function emptySite(assets = new Map()): CapturedSite {
  return { baseUrl: 'https://ex.com/', pages: [], assets, origin: { kind: 'crawl', label: 'x' } };
}

describe('collectImageRefs', () => {
  it('collects images (prefers the srcset LARGEST over the placeholder src), source, video poster, og:image, icon, bg', () => {
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
    // <img src="/a.png" srcset="/a.png 1x, /a-2x.png 2x"> → ONLY the largest (a-2x) is collected; the src/1x
    // thumbnail is NOT double-captured (that clutters imported/<folder> with thumbnail+original pairs).
    expect(keys).toContain('https://ex.com/a-2x.png');
    expect(keys).not.toContain('https://ex.com/a.png');
    expect(keys).toContain('https://ex.com/b.webp');
    expect(keys).toContain('https://ex.com/poster.jpg');
    expect(keys).toContain('https://ex.com/og.jpg');
    expect(keys).toContain('https://ex.com/favicon.png');
    expect(keys).toContain('https://ex.com/bg.jpg');
  });

  it('collects the plain src when there is NO srcset (no dedup to apply)', () => {
    const refs = collectImageRefs([{ url: 'https://ex.com/p', doc: parse('<img src="/only.png">') }], emptySite());
    expect([...refs.keys()]).toContain('https://ex.com/only.png');
  });

  it('prefers a captured asset (with bytes) over a synthesized remote ref', () => {
    const captured = { sourceRef: 'https://ex.com/a.png', kind: 'image' as const, bytes: new Uint8Array([1, 2, 3]) };
    const refs = collectImageRefs([{ url: 'https://ex.com/p', doc: parse('<img src="/a.png">') }], emptySite(new Map([['https://ex.com/a.png', captured]])));
    expect(refs.get('https://ex.com/a.png')).toBe(captured);
  });
});

describe('collectDocumentRefs', () => {
  it('collects PDF/doc links (kind other), ignores normal links + data:', () => {
    const html = `<html><body>
      <a href="/files/brochure.pdf">Brochure</a>
      <a href="https://cdn.x/report.docx?v=2">Report</a>
      <a href="/about">About</a>
      <a href="data:application/pdf;base64,xxx">inline</a>
      <a href="/page.html">Page</a>
    </body></html>`;
    const refs = collectDocumentRefs([{ url: 'https://ex.com/', doc: parse(html) }]);
    const keys = [...refs.keys()];
    expect(refs.size).toBe(2);
    expect(keys.some((k) => k.includes('brochure.pdf'))).toBe(true);
    expect(keys.some((k) => k.includes('report.docx'))).toBe(true);
    expect(keys.some((k) => k.includes('/about'))).toBe(false);
    expect([...refs.values()].every((a) => a.kind === 'other')).toBe(true);
  });

  it('also collects PDF/doc EMBEDS — iframe (incl. lazy data-src), embed, object — so a modal PDF is self-hosted', () => {
    const html = `<html><body>
      <iframe src="/_data/company_profile.pdf"></iframe>
      <iframe data-src="https://ex.com/lazy.pdf"></iframe>
      <embed src="/spec.pdf">
      <object data="/report.docx"></object>
      <iframe src="https://youtube.com/embed/x"></iframe>
    </body></html>`;
    const refs = collectDocumentRefs([{ url: 'https://ex.com/', doc: parse(html) }]);
    const keys = [...refs.keys()];
    expect(keys.some((k) => k.includes('company_profile.pdf'))).toBe(true);
    expect(keys.some((k) => k.includes('lazy.pdf'))).toBe(true);
    expect(keys.some((k) => k.includes('spec.pdf'))).toBe(true);
    expect(keys.some((k) => k.includes('report.docx'))).toBe(true);
    expect(keys.some((k) => k.includes('youtube'))).toBe(false); // a video embed is NOT a document
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

  it('hosts concurrently (bounded), not serially', async () => {
    let inFlight = 0, maxInFlight = 0;
    const many = new Map(Array.from({ length: 20 }, (_, i) => [`https://ex.com/${i}.png`, { sourceRef: String(i), kind: 'image' as const, remoteUrl: `https://ex.com/${i}.png` }]));
    const media: MediaPort = {
      hostAsset: async (a) => {
        inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { ref: `/media/${a.sourceRef}.jpg` };
      },
    };
    const res = await hostAssets(many, media, DEFAULT_LIMITS);
    expect(res.hosted).toBe(20);
    expect(maxInFlight).toBeGreaterThan(1); // proves parallelism (was strictly serial)
    expect(maxInFlight).toBeLessThanOrEqual(8); // bounded by the concurrency cap
  });
});

describe('collectUnhostableMedia', () => {
  it('names the video/audio sources the importer cannot bring across', () => {
    // A clone of a site whose hero is a full-viewport autoplay video came back with NO <video>, no
    // video asset, and no warning: measured on the original, bg_video.webm at 1440x900, autoplay +
    // muted + loop, playing. Video is not a hostable kind, the image collector takes only the poster,
    // and foundation mode re-authors the body — so it vanishes. Naming it is the whole fix for now.
    const html = `<html><body>
      <video src="/_data/assets/bg_video.webm" autoplay muted loop poster="/poster.jpg"></video>
      <video><source src="/clip.mp4" type="video/mp4"><source src="/clip.webm"></video>
      <audio src="/theme.mp3"></audio>
      </body></html>`;
    const found = collectUnhostableMedia([{ url: 'https://ex.com/p', doc: parse(html) }]);
    expect(found).toContain('/_data/assets/bg_video.webm');
    expect(found).toContain('/clip.mp4');   // <source> children, not just the element's own src
    expect(found).toContain('/clip.webm');
    expect(found).toContain('/theme.mp3');
    expect(found).not.toContain('/poster.jpg'); // the poster IS captured, as an image
  });

  it('is quiet on a page with no video, dedupes, and ignores data: URIs', () => {
    expect(collectUnhostableMedia([{ url: 'https://ex.com/p', doc: parse('<html><body><img src="/a.png"></body></html>') }])).toEqual([]);
    const dup = `<html><body><video src="/same.webm"></video><video src="/same.webm"></video>
      <video src="data:video/mp4;base64,AAAA"></video></body></html>`;
    expect(collectUnhostableMedia([{ url: 'https://ex.com/p', doc: parse(dup) }])).toEqual(['/same.webm']);
  });
});
