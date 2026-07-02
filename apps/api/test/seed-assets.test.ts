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
  storeOriginal: vi.fn(async (_in: string, _out: string, opts: { storedName: string }) => ({
    width: 900,
    height: 650,
    format: 'png',
    hasAlpha: false,
    animated: false,
    placeholder: 'data:image/webp;base64,AA==',
    storedName: opts.storedName,
    bytes: 8,
  })),
}));

import { MediaStorage } from '../src/media/storage.js';
import { seedExampleAssets } from '../src/seed-assets.js';

const ctx = { userId: 'u1', projectId: 'p1', role: 'owner' as const };
const slug = 'example'; // media is keyed by the project's (immutable) slug, not its id

describe('seedExampleAssets', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-seedassets-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('generates 28 local images in 6 folders + a schema-valid url map', async () => {
    const puts: Array<{ kind: string; id: string; val: unknown }> = [];
    const repo = {
      put: async (_c: unknown, kind: string, id: string, val: unknown) => {
        // Validate exactly as the real ContentRepository would.
        if (kind === 'media') MediaAssetSchema.parse(val);
        if (kind === 'mediafolder') MediaFolderRecordSchema.parse(val);
        puts.push({ kind, id, val });
      },
    } as never;

    const urls = await seedExampleAssets(ctx, slug, repo, new MediaStorage(root));

    expect(Object.keys(urls)).toHaveLength(28);
    expect(urls['proj-harbor']).toMatch(/^\/media\/example\/ex-proj-harbor\/[\w-]+\.png$/);
    expect(urls['brand-logo']).toBeDefined(); // CI marks (logo/icon/OG)
    expect(urls['brand-icon']).toBeDefined();
    expect(urls['brand-og']).toBeDefined();
    expect(urls['team-devon']).toBeDefined();
    expect(urls['hero']).toBeDefined();
    expect(urls['studio']).toBeDefined();
    expect(urls['studio-meeting']).toBeDefined(); // the About {{#sw-folder}} gallery
    expect(urls['blog-speed']).toBeDefined(); // blog covers
    expect(urls['prod-cap']).toBeDefined(); // MINI SHOP product tiles

    expect(puts.filter((p) => p.kind === 'media')).toHaveLength(28);
    const folders = puts
      .filter((p) => p.kind === 'mediafolder')
      .map((p) => (p.val as { path: string }).path)
      .sort();
    expect(folders).toEqual(['Blog', 'Brand', 'Products', 'Projects', 'Studio', 'Team']);

    const harbor = puts.find((p) => p.id === 'ex-proj-harbor')!.val as { kind: string; original: string; folder: string };
    expect(harbor.kind).toBe('image');
    expect(harbor.folder).toBe('Projects');
    expect(harbor.original.length).toBeGreaterThan(0);
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

    const urls = await seedExampleAssets(ctx, slug, repo, storage);
    expect(Object.keys(urls)).toHaveLength(27); // the failed one is absent
    expect(removed).toBeGreaterThanOrEqual(1); // its half-written dir was removed
  });
});
