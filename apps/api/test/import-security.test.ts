import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { MediaStorage } from '../src/media/storage.js';
import { extractProjectMedia } from '../src/import/unpack-project-zip.js';
import { rewriteMediaSlug } from '../src/import/rewrite-slug.js';
import { UploadError } from '../src/import/upload.js';
import { openProjectZipFile, type OpenProjectZip } from '../src/import/project-zip-file.js';
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

// The reader works from a file descriptor, so a test archive has to land on disk first.
const openedZips: OpenProjectZip[] = [];
const zipDirs: string[] = [];
afterAll(async () => {
  openedZips.forEach((z) => z.close());
  await Promise.all(zipDirs.map((d) => rm(d, { recursive: true, force: true })));
});
async function openZipAt(bytes: Buffer): Promise<OpenProjectZip> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-import-sec-'));
  zipDirs.push(dir);
  const path = join(dir, 'a.zip');
  await writeFile(path, bytes);
  const opened = await openProjectZipFile(path, 10_000);
  openedZips.push(opened);
  return opened;
}

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
    zip.file('bundle.json', '{}'); // non-media entry ignored
    const opened = await openZipAt(await zip.generateAsync({ type: 'nodebuffer' }));

    const count = await extractProjectMedia(opened, storage, 'site');
    expect(count).toBe(3);
    expect(existsSync(join(root, 'site', LEGACY, 'original-800.webp'))).toBe(true);
    expect(existsSync(join(root, 'site', `${SHORT}-photo.png`))).toBe(true);
  });

  it('REFUSES a whole archive that declares a traversal entry name', async () => {
    // ★ Stricter than the old behaviour, which normalized the name and skipped that ONE entry while
    // extracting the rest. A `media/../evil.txt` in a Sitewright export cannot arise by accident —
    // our own writer only ever emits `media/<assetId>/<rel>` — so its presence is evidence of a
    // tampered or hostile archive, and quietly restoring the other 40,000 files from it is the wrong
    // answer. The reader rejects the archive at directory-parse time, before any entry is opened.
    const zip = new JSZip();
    zip.file('media/asset1/ok.webp', 'y');
    zip.file('media/../evil.txt', 'nope');
    await expect(openZipAt(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toBeInstanceOf(UploadError);
    expect(existsSync(join(root, 'site', 'evil.txt'))).toBe(false);
    expect(existsSync(join(root, 'evil.txt'))).toBe(false);
  });

  it('throws when a media entry exceeds the per-entry byte cap (bomb guard)', async () => {
    const zip = new JSZip();
    zip.file('media/asset1/big.webp', Buffer.alloc(4096, 1));
    const opened = await openZipAt(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(
      extractProjectMedia(opened, storage, 'site', {
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
    imageMaps: [],
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
