import { describe, it, expect } from 'vitest';
import type { ProjectBundle } from '@sitewright/core';
import { runWorker, type WorkerJob } from '../src/publish/build-worker.js';

function bundle(over: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    project: {
      id: 'p',
      name: 'Acme',
      slug: 'acme',
      brand: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [],
    partials: [],
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
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Worker Built' } }] } },
        ],
      }),
    };
    const result = await runWorker(job);
    expect(result.manifest.routes).toBe(1);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    expect(home).toContain('Worker Built');
    expect(home).toContain('--sw-color-primary: #0a7;');
  });

  it('reconstructs media from inlined base64 and bundles it into the artifact', async () => {
    const asset = {
      id: 'a1', filename: 'h.png', format: 'image/png', bytes: 3, width: 80, height: 60,
      variants: [{ format: 'webp' as const, width: 40, height: 30, path: 'a1-40.webp' }],
      fallback: 'a1-40.jpg', url: '/media/p/a1/a1-40.jpg',
    };
    const job: WorkerJob = {
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [{ asset, files: { 'a1-40.jpg': Buffer.from('jpgbytes').toString('base64'), 'a1-40.webp': Buffer.from('webpbytes').toString('base64') } }],
      bundle: bundle({
        pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Image', props: { src: '/media/p/a1/a1-40.jpg', alt: 'H' } } }],
      }),
    };
    const result = await runWorker(job);
    const home = Buffer.from(result.files['index.html'] ?? '', 'base64').toString('utf8');
    expect(home).toContain('<picture');
    // The media binary made it into the artifact, decoded correctly.
    expect(Buffer.from(result.files['media/a1/a1-40.jpg'] ?? '', 'base64').toString('utf8')).toBe('jpgbytes');
    expect(result.files['media/a1/a1-40.webp']).toBeDefined();
  });
});
