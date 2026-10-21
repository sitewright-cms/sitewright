import { describe, it, expect } from 'vitest';
import { renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import type { ProjectBundle } from '@sitewright/core';
import { runWorker, type WorkerJob } from '../src/publish/build-worker.js';
import { assetAlias } from '../src/publish/asset-alias.js';

/** True if `buf` is a RIFF/WEBP-container image (magic bytes) — avoids a direct sharp dep in the api test. */
function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

function bundle(over: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    project: {
      formatVersion: 2 as const,
      id: 'p',
      name: 'Acme',
      slug: 'acme',
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [],
    datasets: [],
    entries: [],
    ...over,
  } as ProjectBundle;
}

describe('runWorker', () => {
  it('builds a site entirely from the in-memory job (no disk/secret access)', async () => {
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [],
      bundle: bundle({
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<section><h1>Welcome</h1></section>' },
        ],
      }),
    };
    const result = await runWorker(job);
    expect(result.manifest.routes).toBe(1);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    expect(home).toContain('Welcome');
    expect(home).toMatch(/--sw-color-primary:\s*#0a7/); // CSS minified (space/`;` vary by minifier)
  });

  it('★ ships the statistics tracker with an ABSOLUTE collector when the job carries the key and public URL', async () => {
    // These fields used to be dropped on the way into the worker, so a worker-built site beaconed (and posted
    // its forms) root-relative — to whatever host it was uploaded to.
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [],
      publicBaseUrl: 'https://cms.example.com',
      stats: { key: 'k'.repeat(64) },
      bundle: bundle({
        project: { ...bundle().project, website: { statistics: { enabled: true } } },
        pages: [{ id: 'home', path: '', title: 'Home', source: '<section><h1>Welcome</h1></section>' }],
      }),
    };
    const result = await runWorker(job);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    const m = /data-sw-stats="([^"]+)"/.exec(home);
    expect(m).not.toBeNull();
    expect(JSON.parse(Buffer.from(m![1]!, 'base64').toString('utf8'))).toMatchObject({ b: 'https://cms.example.com', p: 'p', r: '/' });
    expect(result.files['_assets/_sw/stats.js']).toBeDefined();
  });

  it('★ puts the search engine verification tags the job carries in the page head', async () => {
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [],
      siteVerification: { google: 'gTag_1234567890', bing: 'B1NGC0DE' },
      bundle: bundle({ pages: [{ id: 'home', path: '', title: 'Home', source: '<section><h1>Welcome</h1></section>' }] }),
    };
    const home = Buffer.from((await runWorker(job)).files['index.html'] ?? '', 'base64').toString('utf8');
    expect(home).toContain('<meta name="google-site-verification" content="gTag_1234567890" />');
    expect(home).toContain('<meta name="msvalidate.01" content="B1NGC0DE" />');
  });

  it('materializes referenced thumbnails from the inlined ORIGINAL and bundles them into the artifact', async () => {
    // The retained original (a real PNG) is inlined; the worker generates on demand exactly the
    // thumbnail the page references (`?size=sm` → `h-sm.webp`) FLAT into `_assets/<alias>-…`.
    const originalPng = await renderTrustedSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#0a7"/></svg>', 80, 60);
    const asset = {
      kind: 'image' as const, folder: '',
      id: 'a1', filename: 'h.png', format: 'png', bytes: originalPng.length, width: 80, height: 60,
      hasAlpha: false, animated: false, original: 'h.png', url: '/media/p/a1/h.png',
    };
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [{ asset, files: { 'h.png': originalPng.toString('base64') } }],
      bundle: bundle({
        // Code-first: the page references the media via the editor DELIVERY URL with an explicit
        // size; publish rewrites it to the static thumbnail name + rebases FLAT to `_assets/<alias>-…`.
        pages: [{ id: 'home', path: '', title: 'Home', source: '<section><img src="/media/acme/a1/h.png?size=sm" alt="H" /></section>' }],
      }),
    };
    const result = await runWorker(job);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    const a1 = assetAlias('a1');
    // The referenced thumbnail was generated into the artifact and is a valid WebP.
    const thumb = Buffer.from(result.files[`_assets/${a1}-h-sm.webp`] ?? '', 'base64');
    expect(thumb.length).toBeGreaterThan(0);
    expect(isWebp(thumb)).toBe(true);
    // The unreferenced original was NOT copied (minimal export).
    expect(result.files[`_assets/${a1}-h.png`]).toBeUndefined();
    // …and the rendered <img> references the bundled thumbnail, not the editor /media URL.
    expect(home).toContain(`_assets/${a1}-h-sm.webp`);
    expect(home).not.toContain('/media/acme/');
  });
});
