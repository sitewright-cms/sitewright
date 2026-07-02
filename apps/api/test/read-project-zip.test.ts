import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readProjectZip, extractProjectMedia } from '../src/import/unpack-project-zip.js';
import { UploadError } from '../src/import/upload.js';
import { MediaStorage } from '../src/media/storage.js';
import { mkdtemp, rm } from 'node:fs/promises';
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

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('readProjectZip', () => {
  it('parses a valid archive', async () => {
    const buf = await zipOf({ 'manifest.json': JSON.stringify(VALID_MANIFEST), 'bundle.json': JSON.stringify(VALID_BUNDLE) });
    const parsed = await readProjectZip(buf);
    expect(parsed.manifest.mediaSlug).toBe('x');
    expect(parsed.bundle.project.slug).toBe('x');
  });

  it('rejects a non-zip buffer', async () => {
    await expect(readProjectZip(Buffer.from('not a zip at all'))).rejects.toBeInstanceOf(UploadError);
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
      const zip = new JSZip();
      zip.file('media/loosefile.txt', 'x'); // no <assetId>/<file> → skipped
      zip.file('media/asset1/ok.webp', 'y'); // valid
      const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
      expect(await extractProjectMedia(loaded, storage, 'site')).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
