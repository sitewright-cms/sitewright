import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaAssetSchema, MediaFolderRecordSchema } from '@sitewright/schema';

// Mock the heavy image work (sharp rasterize + optimize) so the test exercises the seeding
// ORCHESTRATION fast + deterministically. The SVG generators still run (they build the strings
// passed to the mock), so their branches are covered; only the pixel crunching is stubbed.
vi.mock('@sitewright/image-pipeline', () => ({
  renderTrustedSvgToPng: vi.fn(async () => Buffer.from('PNGBYTES')),
  optimizeImage: vi.fn(async () => ({
    width: 900,
    height: 650,
    placeholder: 'data:image/png;base64,AA==',
    variants: [
      { format: 'avif' as const, width: 800, height: 578, path: 'ex-800.avif' },
      { format: 'webp' as const, width: 800, height: 578, path: 'ex-800.webp' },
    ],
    fallback: 'ex-800.jpg',
  })),
}));

import { MediaStorage } from '../src/media/storage.js';
import { seedExampleAssets } from '../src/seed-assets.js';

const ctx = { userId: 'u1', projectId: 'p1', role: 'owner' as const };

describe('seedExampleAssets', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-seedassets-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('generates 12 local images in 3 folders + a schema-valid url map', async () => {
    const puts: Array<{ kind: string; id: string; val: unknown }> = [];
    const repo = {
      put: async (_c: unknown, kind: string, id: string, val: unknown) => {
        // Validate exactly as the real ContentRepository would.
        if (kind === 'media') MediaAssetSchema.parse(val);
        if (kind === 'mediafolder') MediaFolderRecordSchema.parse(val);
        puts.push({ kind, id, val });
      },
    } as never;

    const urls = await seedExampleAssets(ctx, repo, new MediaStorage(root));

    expect(Object.keys(urls)).toHaveLength(12);
    expect(urls['proj-harbor']).toMatch(/^\/media\/p1\/ex-proj-harbor\/[\w-]+\.jpg$/);
    expect(urls['team-devon']).toBeDefined();
    expect(urls['hero']).toBeDefined();
    expect(urls['studio']).toBeDefined();

    expect(puts.filter((p) => p.kind === 'media')).toHaveLength(12);
    const folders = puts
      .filter((p) => p.kind === 'mediafolder')
      .map((p) => (p.val as { path: string }).path)
      .sort();
    expect(folders).toEqual(['Brand', 'Projects', 'Team']);

    const harbor = puts.find((p) => p.id === 'ex-proj-harbor')!.val as { kind: string; variants: unknown[]; folder: string };
    expect(harbor.kind).toBe('image');
    expect(harbor.folder).toBe('Projects');
    expect(harbor.variants.length).toBeGreaterThan(0);
  });

  it('is best-effort: a failing asset is skipped + cleaned up; the rest still seed', async () => {
    const repo = { put: async () => {} } as never;
    const storage = new MediaStorage(root);
    // Fail the very first asset's staging; count the cleanup.
    let staged = 0;
    const realStage = storage.stageUpload.bind(storage);
    storage.stageUpload = (async (...a: Parameters<typeof realStage>) => {
      if (staged++ === 0) throw new Error('disk full');
      return realStage(...a);
    }) as typeof storage.stageUpload;
    let removed = 0;
    const realRemove = storage.remove.bind(storage);
    storage.remove = (async (...a: Parameters<typeof realRemove>) => {
      removed++;
      return realRemove(...a);
    }) as typeof storage.remove;

    const urls = await seedExampleAssets(ctx, repo, storage);
    expect(Object.keys(urls)).toHaveLength(11); // the failed one is absent
    expect(removed).toBeGreaterThanOrEqual(1); // its half-written dir was removed
  });
});
