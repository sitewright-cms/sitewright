import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { buildSite } from '../src/publish/build.js';

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-publish-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

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
    partials: [],
    datasets: [],
    entries: [],
    ...over,
  } as ProjectBundle;
}

describe('buildSite', () => {
  it('writes one index.html per static page plus a release manifest', async () => {
    const manifest = await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r1', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Welcome' } }] } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Section' } },
        ],
      }),
    });
    expect(manifest.routes).toBe(2);

    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home.startsWith('<!doctype html>')).toBe(true);
    expect(home).toContain('Welcome');
    expect(home).toContain('--sw-color-primary: #0a7;');

    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('data-sw-block="Section"');

    const release = JSON.parse(await readFile(join(outDir, 'release.json'), 'utf8'));
    expect(release.routes).toBe(2);
    expect(release.publishedAt).toBe('2026-05-29T00:00:00.000Z');
  });

  it('aborts when the build exceeds maxOutputBytes (disk-fill DoS guard)', async () => {
    const big = 'x'.repeat(5000);
    await expect(
      buildSite({
        publishedAt: '2026-05-29T00:00:00.000Z',
        outDir,
        maxOutputBytes: 1024, // tiny cap → the first page already overflows
        bundle: bundle({
          pages: [
            { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Html', props: { html: big } } },
          ],
        }),
      }),
    ).rejects.toThrow(/maximum output size/);
  });

  it('expands a collection page per published entry and excludes drafts', async () => {
    await buildSite({
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({
        pages: [
          {
            id: 'post',
            path: '/blog/[slug]',
            title: 'Post',
            collection: { dataset: 'posts', param: 'slug' },
            root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { textField: 'title' } }] },
          },
        ],
        entries: [
          { id: 'p1', dataset: 'posts', status: 'published', values: { slug: 'first', title: 'First Post' } },
          { id: 'p2', dataset: 'posts', status: 'draft', values: { slug: 'second', title: 'Hidden' } },
        ],
      }),
    });

    const first = await readFile(join(outDir, 'blog', 'first', 'index.html'), 'utf8');
    expect(first).toContain('First Post');
    // The draft entry produced no route/file.
    await expect(readFile(join(outDir, 'blog', 'second', 'index.html'), 'utf8')).rejects.toBeTruthy();
  });

  it('bundles media and renders an optimized, page-relative <picture>', async () => {
    const asset = {
      id: 'a1',
      filename: 'hero.png',
      format: 'image/png',
      bytes: 10,
      width: 800,
      height: 600,
      variants: [
        { format: 'avif' as const, width: 400, height: 300, path: 'a1-400.avif' },
        { format: 'webp' as const, width: 400, height: 300, path: 'a1-400.webp' },
      ],
      fallback: 'a1-400.jpg',
      url: '/media/p/a1/a1-400.jpg',
    };
    const reads: string[] = [];
    await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset],
      readMedia: async (assetId, file) => {
        reads.push(`${assetId}/${file}`);
        return Buffer.from(`bytes:${file}`);
      },
      bundle: bundle({
        pages: [
          { id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Image', props: { src: '/media/p/a1/a1-400.jpg', alt: 'Hero' } } },
          { id: 'about', path: '/about', title: 'About', root: { id: 'r2', type: 'Image', props: { src: '/media/p/a1/a1-400.jpg', alt: 'Hero' } } },
        ],
      }),
    });

    // Binaries copied into the artifact.
    expect(reads.sort()).toEqual(['a1/a1-400.avif', 'a1/a1-400.jpg', 'a1/a1-400.webp']);
    expect((await readFile(join(outDir, 'media', 'a1', 'a1-400.jpg'), 'utf8'))).toContain('bytes:a1-400.jpg');

    // Root page references media/… ; the /about page (one level deep) uses ../media/…
    const home = await readFile(join(outDir, 'index.html'), 'utf8');
    expect(home).toContain('<picture');
    expect(home).toContain('srcset="media/a1/a1-400.avif 400w"');
    const about = await readFile(join(outDir, 'about', 'index.html'), 'utf8');
    expect(about).toContain('../media/a1/a1-400.avif 400w');
  });

  it('tolerates a missing media variant without failing the build', async () => {
    const asset = {
      id: 'a2',
      filename: 'x.png',
      format: 'image/png',
      bytes: 10,
      width: 100,
      height: 100,
      variants: [{ format: 'webp' as const, width: 100, height: 100, path: 'a2-100.webp' }],
      fallback: 'a2-100.jpg',
      url: '/media/p/a2/a2-100.jpg',
    };
    const manifest = await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset],
      readMedia: async (_assetId, file) => {
        if (file === 'a2-100.webp') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return Buffer.from('img');
      },
      bundle: bundle({
        pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }],
      }),
    });
    expect(manifest.routes).toBe(1);
    // The present file was copied; the missing one was skipped.
    await expect(readFile(join(outDir, 'media', 'a2', 'a2-100.jpg'), 'utf8')).resolves.toBe('img');
    await expect(readFile(join(outDir, 'media', 'a2', 'a2-100.webp'), 'utf8')).rejects.toBeTruthy();
  });

  it('fails the build on a non-missing media read error (no partial artifact)', async () => {
    const asset = {
      id: 'a4', filename: 'x.png', format: 'image/png', bytes: 1, width: 10, height: 10,
      variants: [], fallback: 'a4-10.jpg', url: '/media/p/a4/a4-10.jpg',
    };
    await expect(
      buildSite({
        publishedAt: '2026-05-30T00:00:00.000Z',
        outDir,
        media: [asset],
        readMedia: async () => {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        },
        bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }),
      }),
    ).rejects.toThrow('disk full');
    // The previous (absent) build dir was not replaced with a partial one.
    await expect(readFile(join(outDir, 'index.html'), 'utf8')).rejects.toBeTruthy();
  });

  it('ignores media when no reader is provided (no copy)', async () => {
    const asset = {
      id: 'a3', filename: 'x.png', format: 'image/png', bytes: 1, width: 10, height: 10,
      variants: [], fallback: 'a3-10.jpg', url: '/media/p/a3/a3-10.jpg',
    };
    await buildSite({
      publishedAt: '2026-05-30T00:00:00.000Z',
      outDir,
      media: [asset], // no readMedia
      bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }),
    });
    await expect(readFile(join(outDir, 'media', 'a3', 'a3-10.jpg'), 'utf8')).rejects.toBeTruthy();
  });

  it('rebuilds cleanly, removing files from a previous build', async () => {
    const opts = {
      publishedAt: '2026-05-29T00:00:00.000Z',
      outDir,
      bundle: bundle({ pages: [{ id: 'gone', path: '/gone', title: 'Gone', root: { id: 'r', type: 'Section' } }] }),
    };
    await buildSite(opts);
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).resolves.toBeTruthy();

    await buildSite({ ...opts, bundle: bundle({ pages: [{ id: 'home', path: '/', title: 'Home', root: { id: 'r', type: 'Section' } }] }) });
    await expect(readFile(join(outDir, 'gone', 'index.html'), 'utf8')).rejects.toBeTruthy();
    await expect(readFile(join(outDir, 'index.html'), 'utf8')).resolves.toBeTruthy();
  });
});
