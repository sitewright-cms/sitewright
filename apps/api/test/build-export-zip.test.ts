import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { buildProjectExportZip, collectExportMedia, ExportSizeLimitError } from '../src/export/build-zip.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sw-build-zip-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildProjectExportZip', () => {
  it('streams manifest + bundle + media files into a loadable archive', async () => {
    const a = join(dir, 'a.bin');
    await writeFile(a, Buffer.from('hello world'));
    const zip = await buildProjectExportZip({
      manifest: { kind: 'sitewright-project-export' },
      bundle: { formatVersion: 2, pages: [] },
      media: [{ assetId: 'asset1', files: [{ rel: 'file/a.bin', abs: a }] }],
      maxBytes: 10 * 1024 * 1024,
    });
    try {
      const loaded = await JSZip.loadAsync(await readFile(zip.path));
      expect(JSON.parse(await loaded.file('manifest.json')!.async('string')).kind).toBe(
        'sitewright-project-export',
      );
      expect(await loaded.file('media/asset1/file/a.bin')!.async('string')).toBe('hello world');
    } finally {
      await zip.cleanup();
    }
    // cleanup removed the temp archive.
    await expect(access(zip.path)).rejects.toThrow();
  });

  it('aborts with ExportSizeLimitError + cleans up when the archive exceeds maxBytes', async () => {
    const big = join(dir, 'big.bin');
    await writeFile(big, Buffer.alloc(64 * 1024, 1));
    let capturedPath = '';
    await expect(
      buildProjectExportZip({
        manifest: {},
        bundle: {},
        media: [{ assetId: 'a', files: [{ rel: 'big.bin', abs: big }] }],
        maxBytes: 256, // far smaller than the compressed output
      }).then((z) => {
        capturedPath = z.path;
      }),
    ).rejects.toBeInstanceOf(ExportSizeLimitError);
    // The temp dir was removed on the failure path (no leak).
    if (capturedPath) await expect(access(capturedPath)).rejects.toThrow();
  });
});

describe('collectExportMedia', () => {
  it('enumerates every asset (batched) and preserves order', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `a${i}`);
    const seen: string[] = [];
    const result = await collectExportMedia(
      async (assetId) => {
        seen.push(assetId);
        return [{ rel: `${assetId}.bin`, abs: `/x/${assetId}.bin` }];
      },
      ids,
      64,
    );
    expect(result.map((r) => r.assetId)).toEqual(ids); // order preserved across batches
    expect(seen).toHaveLength(150);
    expect(result[0]!.files[0]!.rel).toBe('a0.bin');
  });
});
