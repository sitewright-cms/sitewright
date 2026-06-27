import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceRefStore, type SourceRef } from '../src/render/source-ref.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-srcref-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ref = (url = 'https://ex.com/'): SourceRef => ({
  sourceUrl: url,
  capturedAt: 1_700_000_000_000,
  shots: { fullhd: { base64: 'QUFB', mimeType: 'image/jpeg', width: 1920, height: 1080 } },
});

describe('SourceRefStore', () => {
  it('round-trips a reference (put → get)', async () => {
    const store = new SourceRefStore(root);
    await store.put('site', 'home', ref());
    expect(await store.get('site', 'home')).toEqual(ref());
  });

  it('returns null for a missing reference', async () => {
    expect(await new SourceRefStore(root).get('site', 'never')).toBeNull();
  });

  it('keys pages by a filesystem-safe name (no traversal from a hostile page id)', async () => {
    const store = new SourceRefStore(root);
    await store.put('site', '../../etc/passwd', ref());
    // The reference is retrievable by the SAME id, and nothing escaped the slug dir.
    expect(await store.get('site', '../../etc/passwd')).toEqual(ref());
    const files = await readdir(join(root, 'site'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[A-Za-z0-9_-]+\.json$/); // base64url key, never a path
  });

  it('rejects an invalid project slug (defense-in-depth)', async () => {
    const store = new SourceRefStore(root);
    await expect(store.put('../evil', 'home', ref())).rejects.toThrow(/invalid project slug/);
    await expect(store.removeProject('../evil')).rejects.toThrow(/invalid project slug/);
  });

  it('removeProject deletes all of a project’s references and is idempotent', async () => {
    const store = new SourceRefStore(root);
    await store.put('site', 'home', ref());
    await store.put('site', 'about', ref());
    await store.removeProject('site');
    expect(await store.get('site', 'home')).toBeNull();
    await expect(store.removeProject('site')).resolves.toBeUndefined(); // idempotent
  });

  it('tolerates a corrupt reference file (treats it as a miss)', async () => {
    const store = new SourceRefStore(root);
    await store.put('site', 'home', ref());
    // Overwrite the stored JSON with garbage → get() must not throw.
    const file = join(root, 'site', `${Buffer.from('home').toString('base64url')}.json`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{not json');
    expect(await store.get('site', 'home')).toBeNull();
  });
});
