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

const LEGACY = 'legacy-asset-1'; // not a 6-char base62 id → per-asset folder (with `file/` nesting)
const SHORT = 'a1B2c3'; // 6-char base62 id → flat `<slug>/<id>-<name>` (single segment, no nesting)

describe('MediaStorage.importAssetFile (zip-slip defense)', () => {
  it('LEGACY id: writes a valid top-level + nested `file/` entry, confined to the asset dir', async () => {
    await storage.importAssetFile('site', LEGACY, 'original-800.webp', Buffer.from('a'));
    await storage.importAssetFile('site', LEGACY, 'file/doc.pdf', Buffer.from('b'));
    expect(existsSync(join(root, 'site', LEGACY, 'original-800.webp'))).toBe(true);
    expect(await readFile(join(root, 'site', LEGACY, 'file', 'doc.pdf'), 'utf8')).toBe('b');
  });

  it('SHORT id: writes a single logical entry FLAT (`<slug>/<id>-<name>`), rejecting any nesting', async () => {
    await storage.importAssetFile('site', SHORT, 'photo.png', Buffer.from('a'));
    expect(existsSync(join(root, 'site', `${SHORT}-photo.png`))).toBe(true);
    expect(existsSync(join(root, 'site', SHORT))).toBe(false); // no per-asset folder
    await expect(storage.importAssetFile('site', SHORT, 'file/doc.pdf', Buffer.from('b'))).rejects.toThrow();
  });

  it('rejects traversal / absolute / backslash / dotfiles / bad segments (both layouts)', async () => {
    for (const id of [LEGACY, SHORT]) {
      for (const rel of ['../evil', 'a/../../evil', '/etc/passwd', 'a\\b', '.', 'a/./b', 'a b/c', 'x/y/z/w', '.htaccess', '.env', 'file/.env']) {
        await expect(storage.importAssetFile('site', id, rel, Buffer.from('x'))).rejects.toThrow();
      }
    }
    // Nothing escaped the project's media dir; no dotfile landed inside it either.
    expect(existsSync(join(root, 'evil'))).toBe(false);
    expect(existsSync(join(root, 'site', LEGACY, '.htaccess'))).toBe(false);
  });

  it('rejects an invalid asset id / slug before touching disk', async () => {
    await expect(storage.importAssetFile('site', '../evil', 'a.webp', Buffer.from('x'))).rejects.toThrow();
  });
});

describe('extractProjectMedia', () => {
  it('extracts valid media entries (legacy foldered + flat) and SKIPS traversal entry names', async () => {
    const zip = new JSZip();
    zip.file(`media/${LEGACY}/original-800.webp`, 'img');
    zip.file(`media/${LEGACY}/file/doc.pdf`, 'doc');
    zip.file(`media/${SHORT}/photo.png`, 'flat'); // a flat (short-id) asset → <slug>/<id>-photo.png
    zip.file('media/../evil.txt', 'nope'); // traversal → normalizeZipPath drops it
    zip.file('bundle.json', '{}'); // non-media entry ignored
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const loaded = await JSZip.loadAsync(buf);

    const count = await extractProjectMedia(loaded, storage, 'site');
    expect(count).toBe(3);
    expect(existsSync(join(root, 'site', LEGACY, 'original-800.webp'))).toBe(true);
    expect(existsSync(join(root, 'site', `${SHORT}-photo.png`))).toBe(true);
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
