import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { dataFolderUsage } from '../src/db/data-usage.js';

let root: string;
let dataDir: string;

async function file(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'x'.repeat(bytes));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-data-usage-'));
  dataDir = join(root, 'data');
  await file(join(dataDir, 'sitewright.db'), 100);
  await file(join(dataDir, 'analytics.db'), 50);
  await file(join(dataDir, 'backups', 'one.pre-migration.bak'), 40);
  await file(join(dataDir, 'media', 'p1', 'a.webp'), 30);
  await file(join(dataDir, 'media', 'p1', 'deep', 'b.webp'), 20);
  await file(join(dataDir, 'sites', 'p1', 'index.html'), 7);
  await file(join(dataDir, 'preview', 'p1', 'index.html'), 5);
  await file(join(dataDir, 'source-refs', 's1', 'page.html'), 3);
  await file(join(dataDir, 'notes.txt'), 1);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('dataFolderUsage', () => {
  it('sums every file under the data folder, and splits out media and builds', async () => {
    expect(await dataFolderUsage(dataDir)).toEqual({ totalBytes: 256, mediaBytes: 50, buildsBytes: 15, partial: false });
  });

  it('★ follows no link inside the tree: one pointing back up is neither counted twice nor walked forever', async () => {
    await symlink(dataDir, join(dataDir, 'media', 'p1', 'loop'));
    await symlink(join(dataDir, 'sitewright.db'), join(dataDir, 'sites', 'p1', 'db-link'));
    expect(await dataFolderUsage(dataDir)).toEqual({ totalBytes: 256, mediaBytes: 50, buildsBytes: 15, partial: false });
  });

  it('★ follows a link directly in the data folder: a sub-folder kept on another disk is still counted', async () => {
    await rm(join(dataDir, 'media'), { recursive: true });
    await file(join(root, 'other-disk', 'media', 'big.webp'), 500);
    await symlink(join(root, 'other-disk', 'media'), join(dataDir, 'media'));
    expect(await dataFolderUsage(dataDir)).toEqual({ totalBytes: 706, mediaBytes: 500, buildsBytes: 15, partial: false });
  });

  it('a dangling link in the data folder counts as nothing', async () => {
    await symlink(join(root, 'gone'), join(dataDir, 'stale'));
    expect((await dataFolderUsage(dataDir)).totalBytes).toBe(256);
  });

  it('stops at its entry limit and says the figures are partial', async () => {
    const usage = await dataFolderUsage(dataDir, { deadlineMs: 60_000, maxEntries: 3 });
    expect(usage.partial).toBe(true);
    expect(usage.totalBytes).toBeLessThan(256);
  });

  it('stops at its deadline and says the figures are partial', async () => {
    const usage = await dataFolderUsage(dataDir, { deadlineMs: 0, maxEntries: 1_000 });
    expect(usage).toEqual({ totalBytes: 0, mediaBytes: 0, buildsBytes: 0, partial: true });
  });

  it('★ stops at its entry limit inside one large folder, not only between folders', async () => {
    const big = join(root, 'big');
    await mkdir(join(big, 'media', 'p1'), { recursive: true });
    await Promise.all(Array.from({ length: 200 }, (_, i) => writeFile(join(big, 'media', 'p1', `f${i}`), 'x')));
    expect(await dataFolderUsage(big)).toEqual({ totalBytes: 200, mediaBytes: 200, buildsBytes: 0, partial: false });
    const capped = await dataFolderUsage(big, { deadlineMs: 60_000, maxEntries: 70 });
    expect(capped.partial).toBe(true);
    expect(capped.mediaBytes).toBeGreaterThan(0);
    expect(capped.mediaBytes).toBeLessThan(200);
  });

  it('★ stops at its deadline inside one large folder', async () => {
    const big = join(root, 'big');
    await mkdir(join(big, 'media', 'p1'), { recursive: true });
    await Promise.all(Array.from({ length: 200 }, (_, i) => writeFile(join(big, 'media', 'p1', `f${i}`), 'x')));
    // Each look at the clock moves it on a second: the 4-second deadline passes partway through the folder.
    let clock = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
    try {
      const usage = await dataFolderUsage(big, { deadlineMs: 4_000, maxEntries: 1_000 });
      expect(usage.partial).toBe(true);
      expect(usage.mediaBytes).toBeGreaterThan(0);
      expect(usage.mediaBytes).toBeLessThan(200);
    } finally {
      now.mockRestore();
    }
  });

  it('a data folder that does not exist is empty', async () => {
    expect(await dataFolderUsage(join(root, 'nowhere'))).toEqual({ totalBytes: 0, mediaBytes: 0, buildsBytes: 0, partial: false });
  });
});
