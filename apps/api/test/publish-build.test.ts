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
