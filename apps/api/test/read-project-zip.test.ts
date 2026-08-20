import { describe, it, expect, afterAll } from 'vitest';
import JSZip from 'jszip';
import { readProjectZip, extractProjectMedia } from '../src/import/unpack-project-zip.js';
import { UploadError } from '../src/import/upload.js';
import { openProjectZipFile } from '../src/import/project-zip-file.js';
import { MediaStorage } from '../src/media/storage.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VALID_MANIFEST = {
  kind: 'sitewright-project-export',
  exportFormat: 1,
  bundleFormat: 2,
  exportedAt: '2026-01-01T00:00:00.000Z',
  source: { id: 'p', name: 'X', slug: 'x' },
  mediaSlug: 'x',
};
const VALID_BUNDLE = {
  formatVersion: 2,
  project: { id: 'p', name: 'X', slug: 'x', identity: { name: 'X', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
};

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Builds a zip and returns its PATH — the reader takes a file, never a buffer. */
async function zipOf(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return writeZip(await zip.generateAsync({ type: 'nodebuffer' }));
}

async function writeZip(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-zip-test-'));
  tempDirs.push(dir);
  const path = join(dir, 'project.zip');
  await writeFile(path, bytes);
  return path;
}

describe('readProjectZip', () => {
  it('parses a valid archive', async () => {
    const buf = await zipOf({ 'manifest.json': JSON.stringify(VALID_MANIFEST), 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    const parsed = await readProjectZip(buf);
    expect(parsed.manifest.mediaSlug).toBe('x');
    expect(parsed.bundle.project.slug).toBe('x');
  });

  it('rejects a non-zip buffer', async () => {
    await expect(readProjectZip(await writeZip(Buffer.from('not a zip at all')))).rejects.toBeInstanceOf(UploadError);
  });

  it('rejects an archive missing manifest.json / bundle.json', async () => {
    await expect(readProjectZip(await zipOf({ 'bundle.json': JSON.stringify(VALID_BUNDLE) }))).rejects.toThrow(/manifest\.json/);
    await expect(readProjectZip(await zipOf({ 'manifest.json': JSON.stringify(VALID_MANIFEST) }))).rejects.toThrow(/bundle\.json/);
  });

  it('rejects non-JSON documents', async () => {
    const buf = await zipOf({ 'manifest.json': 'not json', 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    await expect(readProjectZip(buf)).rejects.toThrow(/not valid JSON/);
  });

  it('rejects an invalid manifest', async () => {
    const buf = await zipOf({ 'manifest.json': '{}', 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    await expect(readProjectZip(buf)).rejects.toThrow(/invalid export manifest/);
  });

  it('rejects an invalid bundle', async () => {
    const buf = await zipOf({ 'manifest.json': JSON.stringify(VALID_MANIFEST), 'bundle.json': '{}' });
    await expect(readProjectZip(buf)).rejects.toThrow(/invalid project bundle/);
  });

  it('rejects an export from a newer format version', async () => {
    const buf = await zipOf({ 'manifest.json': JSON.stringify({ ...VALID_MANIFEST, exportFormat: 999 }), 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    await expect(readProjectZip(buf)).rejects.toThrow(/newer version/);
  });

  it('rejects when too many entries', async () => {
    const buf = await zipOf({ 'manifest.json': JSON.stringify(VALID_MANIFEST), 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    await expect(readProjectZip(buf, { maxEntries: 1, maxEntryBytes: 1024, maxTotalBytes: 1024 })).rejects.toThrow(/too many entries/);
  });
});

describe('extractProjectMedia — edge entries', () => {
  it('skips a media entry that has no asset-id directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sw-extract-'));
    try {
      const storage = new MediaStorage(root);
      const path = await zipOf({
        'media/loosefile.txt': 'x', // no <assetId>/<file> → skipped
        'media/asset1/ok.webp': 'y', // valid
      });
      const opened = await openProjectZipFile(path, 1000);
      try {
        expect(await extractProjectMedia(opened, storage, 'site')).toBe(1);
      } finally {
        opened.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
