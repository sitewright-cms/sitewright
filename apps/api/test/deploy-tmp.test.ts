import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepOrphanedDeployDirs, DEPLOY_TMP_PREFIX, DEPLOY_TMP_MAX_AGE_MS } from '../src/publish/deploy-tmp.js';

// The last line of defence for the one artifact that puts a live credential on this host's disk.
// Every deploy path removes its payload in a `finally`; this covers the case a `finally` cannot —
// SIGKILL/OOM between writing sw-mail.config.php and finishing the upload.

const HOUR = 60 * 60 * 1000;

describe('sweepOrphanedDeployDirs', () => {
  let base: string;
  const NOW = 1_800_000_000_000;

  /** Creates a directory with a controlled mtime, optionally holding a credentials file. */
  async function payload(name: string, ageMs: number, withSecret = true): Promise<string> {
    const dir = join(base, name);
    await mkdir(dir, { recursive: true });
    if (withSecret) await writeFile(join(dir, 'sw-mail.config.php'), '<?php return array("pass"=>"s3cr3t");', 'utf8');
    const when = new Date(NOW - ageMs);
    await utimes(dir, when, when);
    return dir;
  }

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'sw-sweep-test-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('★ removes an aged payload, credentials and all', async () => {
    await payload(`${DEPLOY_TMP_PREFIX}abc123`, 12 * HOUR);
    const { removed } = await sweepOrphanedDeployDirs({ dir: base, now: NOW });
    expect(removed).toBe(1);
    expect(await readdir(base)).toEqual([]);
  });

  it('★ leaves a RECENT payload alone — it belongs to a deploy that is probably still running', async () => {
    // Deleting a live payload mid-upload would break a customer's site rather than protect it, so
    // the age floor is the whole safety argument for sweeping a shared temp dir at all.
    await payload(`${DEPLOY_TMP_PREFIX}live`, 5 * 60 * 1000);
    const { removed } = await sweepOrphanedDeployDirs({ dir: base, now: NOW });
    expect(removed).toBe(0);
    expect(await readdir(base)).toEqual([`${DEPLOY_TMP_PREFIX}live`]);
  });

  it('touches nothing that is not ours, however old', async () => {
    await payload('sw-deploy', 99 * HOUR, false); // prefix is `sw-deploy-`; this is NOT a match
    await payload('other-tool-cache', 99 * HOUR, false);
    await writeFile(join(base, `${DEPLOY_TMP_PREFIX}file-not-dir`), 'x', 'utf8');
    const { removed } = await sweepOrphanedDeployDirs({ dir: base, now: NOW });
    expect(removed).toBe(0);
    expect((await readdir(base)).sort()).toEqual(
      ['other-tool-cache', 'sw-deploy', `${DEPLOY_TMP_PREFIX}file-not-dir`].sort(),
    );
  });

  it('sweeps every eligible payload and reports each one', async () => {
    await payload(`${DEPLOY_TMP_PREFIX}one`, 7 * HOUR);
    await payload(`${DEPLOY_TMP_PREFIX}two`, 8 * HOUR);
    await payload(`${DEPLOY_TMP_PREFIX}young`, 60 * 1000);
    const seen: string[] = [];
    const { removed } = await sweepOrphanedDeployDirs({ dir: base, now: NOW, log: (m) => seen.push(m) });
    expect(removed).toBe(2);
    expect(seen).toHaveLength(2);
    expect(await readdir(base)).toEqual([`${DEPLOY_TMP_PREFIX}young`]);
  });

  it('never throws when the directory does not exist — a sweep failure must not block boot', async () => {
    await expect(sweepOrphanedDeployDirs({ dir: join(base, 'nope'), now: NOW })).resolves.toEqual({ removed: 0 });
  });

  it('honours an explicit maxAge, and the default is hours not minutes', async () => {
    await payload(`${DEPLOY_TMP_PREFIX}x`, 30 * 60 * 1000);
    expect((await sweepOrphanedDeployDirs({ dir: base, now: NOW, maxAgeMs: 10 * 60 * 1000 })).removed).toBe(1);
    expect(DEPLOY_TMP_MAX_AGE_MS).toBeGreaterThanOrEqual(HOUR);
  });
});
