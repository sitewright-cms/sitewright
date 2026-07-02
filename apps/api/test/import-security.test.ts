import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MediaStorage } from '../src/media/storage.js';
import { extractProjectMedia } from '../src/import/unpack-project-zip.js';
import { rewriteMediaSlug } from '../src/import/rewrite-slug.js';
import { UploadError } from '../src/import/upload.js';
import type { ProjectExportBundle } from '@sitewright/schema';

let root: string;
let storage: MediaStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-import-sec-'));
  storage = new MediaStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('MediaStorage.importAssetFile (zip-slip defense)', () => {
  it('writes a valid top-level + nested file, confined to the asset dir', async () => {
    await storage.importAssetFile('site', 'asset1', 'original-800.webp', Buffer.from('a'));
    await storage.importAssetFile('site', 'asset1', 'file/doc.pdf', Buffer.from('b'));
    expect(existsSync(join(root, 'site', 'asset1', 'original-800.webp'))).toBe(true);
    expect(await readFile(join(root, 'site', 'asset1', 'file', 'doc.pdf'), 'utf8')).toBe('b');
  });

  it('rejects traversal / absolute / backslash / bad segments', async () => {
    for (const rel of ['../evil', 'a/../../evil', '/etc/passwd', 'a\\b', '.', 'a/./b', 'a b/c', 'x/y/z/w']) {
      await expect(storage.importAssetFile('site', 'asset1', rel, Buffer.from('x'))).rejects.toThrow();
    }
    // Nothing escaped the project's media dir.
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  it('rejects an invalid asset id / slug before touching disk', async () => {
    await expect(storage.importAssetFile('site', '../evil', 'a.webp', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('extractProjectMedia', () => {
  it('extracts valid media entries and SKIPS traversal entry names', async () => {
    const zip = new JSZip();
    zip.file('media/asset1/original-800.webp', 'img');
    zip.file('media/asset1/file/doc.pdf', 'doc');
    zip.file('media/../evil.txt', 'nope'); // traversal → normalizeZipPath drops it
    zip.file('bundle.json', '{}'); // non-media entry ignored
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf);

    const count = await extractProjectMedia(loaded, storage, 'site');
    expect(count).toBe(2);
    expect(existsSync(join(root, 'site', 'asset1', 'original-800.webp'))).toBe(true);
    expect(existsSync(join(root, 'site', 'evil.txt'))).toBe(false);
    expect(existsSync(join(root, 'evil.txt'))).toBe(false);
  });

  it('throws when a media entry exceeds the per-entry byte cap (bomb guard)', async () => {
    const zip = new JSZip();
    zip.file('media/asset1/big.webp', Buffer.alloc(4096, 1));
    const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(
      extractProjectMedia(loaded, storage, 'site', {
        maxEntries: 100,
        maxEntryBytes: 256, // below the entry size
        maxTotalBytes: 10_000,
      }),
    ).rejects.toBeInstanceOf(UploadError);
  });
});

function bundleWith(url: string): ProjectExportBundle {
  return {
    formatVersion: 2,
    project: { id: 'p', name: 'X', slug: 'old', identity: { name: 'X', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
    pages: [{ id: 'home', path: '', title: 'Home', data: { hero: url } }],
    templates: [],
    snippets: [],
    datasets: [],
    entries: [],
    translations: [],
    forms: [],
    media: [{ kind: 'file', id: 'a1', filename: 'd.pdf', folder: '', bytes: 1, contentType: 'application/pdf', storedName: 'd.pdf', url }],
    mediaFolders: [],
  } as ProjectExportBundle;
}

describe('rewriteMediaSlug', () => {
  it('rewrites every /media/<oldSlug>/ reference to the new slug', () => {
    const out = rewriteMediaSlug(bundleWith('/media/old/a1/file/d.pdf'), 'old', 'old-2');
    expect(out.media[0]!.url).toBe('/media/old-2/a1/file/d.pdf');
    expect((out.pages[0]!.data as { hero: string }).hero).toBe('/media/old-2/a1/file/d.pdf');
  });

  it('is a no-op when the slug is unchanged', () => {
    const input = bundleWith('/media/old/a1/file/d.pdf');
    expect(rewriteMediaSlug(input, 'old', 'old')).toBe(input);
  });
});
