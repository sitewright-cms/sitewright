import { describe, it, expect } from 'vitest';
import type { ProjectBundle } from '@sitewright/core';
import { runWorker, type WorkerJob } from '../src/publish/build-worker.js';

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
          { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Welcome</h1></section>' },
        ],
      }),
    };
    const result = await runWorker(job);
    expect(result.manifest.routes).toBe(1);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    expect(home).toContain('Welcome');
    expect(home).toContain('--sw-color-primary: #0a7;');
  });

  it('reconstructs media from inlined base64 and bundles it into the artifact', async () => {
    const asset = {
      kind: 'image' as const, folder: '',
      id: 'a1', filename: 'h.png', format: 'image/png', bytes: 3, width: 80, height: 60,
      variants: [{ format: 'webp' as const, width: 40, height: 30, path: 'a1-40.webp' }],
      fallback: 'a1-40.jpg', url: '/media/p/a1/a1-40.jpg',
    };
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [{ asset, files: { 'a1-40.jpg': Buffer.from('jpgbytes').toString('base64'), 'a1-40.webp': Buffer.from('webpbytes').toString('base64') } }],
      bundle: bundle({
        // Code-first: the page references the media via a raw <img> editor URL
        // (`/media/<projectSlug>/<assetId>/…`), which the publish-time media rewrite
        // rebases to the bundled `_assets/<assetId>/…` path.
        pages: [{ id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><img src="/media/acme/a1/a1-40.jpg" alt="H" /></section>' }],
      }),
    };
    const result = await runWorker(job);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    // The media binary made it into the artifact (under _assets/), decoded correctly.
    expect(Buffer.from(result.files['_assets/a1/a1-40.jpg'] ?? '', 'base64').toString('utf8')).toBe('jpgbytes');
    expect(result.files['_assets/a1/a1-40.webp']).toBeDefined();
    // …and the rendered <img> references the bundled path, not the editor /media URL.
    expect(home).toContain('_assets/a1/');
    expect(home).not.toContain('/media/acme/');
  });
});
