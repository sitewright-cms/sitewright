import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDb } from './helpers.js';
import { seedInstance } from '../src/seed.js';
import { users, projects } from '../src/db/schema.js';

// The Example Project's demo imagery (seedExampleAssets) and its self-hosted heading webfont
// (downloadGoogleFont) are BEST-EFFORT: a failure of either must never abort the content seed —
// otherwise the idempotency guard would lock in a half-seeded demo. Force BOTH to fail and assert
// the admin + Example Project still seed (without images / with a system heading font).
vi.mock('../src/seed-assets.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/seed-assets.js')>()),
  seedExampleAssets: vi.fn().mockRejectedValue(new Error('image generation unavailable')),
}));
vi.mock('../src/fonts/service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/fonts/service.js')>()),
  downloadGoogleFont: vi.fn().mockRejectedValue(new Error('font CDN unreachable')),
}));

describe('seedInstance — best-effort demo media is resilient', { timeout: 30_000 }, () => {
  afterEach(() => vi.restoreAllMocks());

  it('still seeds the admin + Example Project when demo image generation AND the heading-font download fail', async () => {
    const db = await makeTestDb();
    const mediaRoot = mkdtempSync(join(tmpdir(), 'sw-seed-resilience-'));
    const log: string[] = [];
    try {
      await seedInstance({
        db,
        adminEmail: 'admin@sitewright.example',
        adminPassword: 'Pw-secret-1',
        mediaRoot,
        log: (m) => log.push(m),
      });
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true }); // don't leak the temp media dir
    }

    // Both best-effort steps failed, yet the seed completed.
    expect((await db.select().from(users)).map((u) => u.email)).toEqual(['admin@sitewright.example']);
    expect((await db.select().from(projects)).map((p) => p.name)).toContain('Example Project');
    // Each failure was caught + warned (not thrown).
    expect(log.join('\n')).toMatch(/demo image generation failed/);
    expect(log.join('\n')).toMatch(/Google-font download failed/);
  });
});
