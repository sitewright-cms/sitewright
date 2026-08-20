import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  MAX_PROJECT_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_ENTRIES,
  ARCHIVE_DISK_RESERVE_BYTES,
  DiskSpaceError,
  assertDiskHeadroom,
} from '../src/limits.js';
import { DEFAULT_PROJECT_ZIP_LIMITS } from '../src/import/unpack-project-zip.js';
import { archiveSite, SiteArchiveSizeError } from '../src/publish/adapters.js';

/**
 * PROJECT-SCALE LIMITS.
 *
 * These tests exist because the previous values did not fail loudly — they failed as a flat refusal
 * on the one project big enough to reach them, and the numbers had drifted apart so the two ends of a
 * round trip disagreed. What is protected here is the RELATIONSHIP between them and the mechanism
 * that makes a big number safe, not the numbers themselves.
 */
describe('project-scale limits', () => {
  it('uses ONE ceiling for both ends of the round trip', () => {
    // ★ The defect this locks out: the export cap was 500 MiB, the site archive 100 MiB and the
    // import 200 MiB. A project could be exported and never re-imported — a backup you cannot
    // restore — and nothing anywhere said so. Three numbers in three files is how that happens.
    expect(DEFAULT_PROJECT_ZIP_LIMITS.maxTotalBytes).toBe(MAX_PROJECT_ARCHIVE_BYTES);
    expect(DEFAULT_PROJECT_ZIP_LIMITS.maxEntryBytes).toBe(MAX_ARCHIVE_ENTRY_BYTES);
    expect(DEFAULT_PROJECT_ZIP_LIMITS.maxEntries).toBe(MAX_ARCHIVE_ENTRIES);
  });

  it('clears the largest real project by a wide margin', () => {
    // The reference project: 2.9 GB of media, 1.25 GB built. A ceiling that merely fits today's
    // biggest project is one release away from being the next flat refusal.
    const REFERENCE_PROJECT_BYTES = 3 * 1024 * 1024 * 1024;
    expect(MAX_PROJECT_ARCHIVE_BYTES).toBeGreaterThanOrEqual(REFERENCE_PROJECT_BYTES * 8);
  });

  describe('assertDiskHeadroom', () => {
    it('passes when the filesystem has room', async () => {
      await expect(assertDiskHeadroom(tmpdir(), 1024)).resolves.toBeUndefined();
    });

    it('refuses — with the numbers — when the request plus the reserve does not fit', async () => {
      // A byte ceiling is a promise the DISK has to keep. Without this the failure is an ENOSPC
      // part-way through a multi-gigabyte write, which surfaces as a crash and can take unrelated
      // writes down with it.
      const huge = Number.MAX_SAFE_INTEGER - ARCHIVE_DISK_RESERVE_BYTES;
      await expect(assertDiskHeadroom(tmpdir(), huge)).rejects.toBeInstanceOf(DiskSpaceError);
      await expect(assertDiskHeadroom(tmpdir(), huge)).rejects.toThrow(/free disk space/);
    });

    it('ALLOWS a path it cannot stat rather than inventing a shortage', async () => {
      // An unreadable statfs is not evidence of a full disk. Refusing on it would break archives on
      // any platform that does not implement it — a guard that fails closed on missing information
      // is a new outage, not a safeguard.
      await expect(assertDiskHeadroom(join(tmpdir(), 'sw-does-not-exist-xyz'), 1024)).resolves.toBeUndefined();
    });
  });

  describe('archiveSite streams instead of buffering', () => {
    const build = async (): Promise<string> => {
      const dir = await mkdtemp(join(tmpdir(), 'sw-archive-site-'));
      await mkdir(join(dir, 'about'), { recursive: true });
      await writeFile(join(dir, 'index.html'), '<!doctype html><p>home</p>');
      await writeFile(join(dir, 'about', 'index.html'), '<!doctype html><p>about</p>');
      return dir;
    };

    it('returns a temp FILE, not a Buffer, and its contents are a real zip', async () => {
      // ★ The point of the change. Holding the finished zip in memory is why this path carried a
      // 100 MiB cap, which put "download your site" out of reach of a 1.25 GB site — precisely the
      // project most likely to need a manual deployment path.
      const site = await build();
      const archive = await archiveSite(site);
      try {
        expect(typeof archive.path).toBe('string');
        expect(archive.bytes).toBeGreaterThan(0);
        const zip = await JSZip.loadAsync(await readFileOf(archive.path));
        expect(Object.keys(zip.files)).toContain('index.html');
        expect(await zip.file('about/index.html')!.async('string')).toContain('about');
      } finally {
        await archive.cleanup();
        await rm(site, { recursive: true, force: true });
      }
    });

    it('trips its cap mid-stream and leaves no temp directory behind', async () => {
      const site = await build();
      const before = await tempEntryCount();
      try {
        await expect(archiveSite(site, 8)).rejects.toBeInstanceOf(SiteArchiveSizeError);
        // A refused build that leaves its partial archive on disk turns one failure into a slow leak.
        expect(await tempEntryCount()).toBe(before);
      } finally {
        await rm(site, { recursive: true, force: true });
      }
    });
  });
});

async function readFileOf(path: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

/** How many `sw-site-archive-*` temp dirs exist — a leak detector for the failure path. */
async function tempEntryCount(): Promise<number> {
  const names = await readdir(tmpdir());
  return names.filter((n) => n.startsWith('sw-site-archive-')).length;
}
