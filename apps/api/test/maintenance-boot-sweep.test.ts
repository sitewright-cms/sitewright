import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness } from './harness.js';

/**
 * ★ The sweeps must run SHORTLY AFTER BOOT, not only on the interval.
 *
 * With `setInterval` alone an instance restarted more often than the interval never sweeps at all —
 * the timer is always cancelled before it fires. A development instance, anything redeployed a few
 * times a day, and every crash-looping container fall into that, and the symptom is silence rather
 * than an error: housekeeping that only runs on quiet machines does not run on the machines with the
 * most to clean.
 */

let harness: Harness | undefined;
let root: string;

const sitesDir = () => join(root, 'sites');

beforeEach(async () => {
  vi.useFakeTimers();
  root = await mkdtemp(join(tmpdir(), 'sw-boot-sweep-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await harness?.close();
  harness = undefined;
});

describe('maintenance sweeps at boot', () => {
  it('reaps an unserved build without waiting a whole interval', async () => {
    // A build for a project that does not exist at all: unreachable by any rule.
    const dir = join(sitesDir(), 'ghost');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), 'stale');

    harness = await makeHarness({
      publishRoot: sitesDir(),
      previewRoot: join(root, 'preview'),
      sourceRefRoot: join(root, 'source-refs'),
      maintenanceSweepMs: 60 * 60 * 1000, // the production hour
    });

    expect(await readdir(sitesDir())).toEqual(['ghost']); // nothing has run yet

    // Advance past the first-run delay ONLY — nowhere near the hourly interval.
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.waitFor(async () => expect(await readdir(sitesDir())).toEqual([]));
  });

  it('★ still sweeps on an instance that never stays up for a full interval', async () => {
    // The regression this guards: two boots, each shorter than the interval. Under `setInterval`
    // alone neither would ever have swept, and the disk would grow forever with nothing logged.
    for (const slug of ['first', 'second']) {
      const dir = join(sitesDir(), slug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.html'), 'stale');

      const h = await makeHarness({ publishRoot: sitesDir(), maintenanceSweepMs: 60 * 60 * 1000 });
      await vi.advanceTimersByTimeAsync(31_000);
      await vi.waitFor(async () => expect(await readdir(sitesDir())).toEqual([]));
      await h.close();
    }
  });

  it('runs nothing at all when the sweep is disabled', async () => {
    const dir = join(sitesDir(), 'kept');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), 'stale');

    harness = await makeHarness({ publishRoot: sitesDir(), maintenanceSweepMs: 0 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await readdir(sitesDir())).toEqual(['kept']);
  });

  it('leaves a preview build that is inside the retention window', async () => {
    const dir = join(root, 'preview', 'fresh');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), 'built just now');

    harness = await makeHarness({ previewRoot: join(root, 'preview'), maintenanceSweepMs: 60 * 60 * 1000 });
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(await readdir(join(root, 'preview'))).toEqual(['fresh']);
  });

  it('reaps a preview build past the configured window', async () => {
    const dir = join(root, 'preview', 'ancient');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'index.html');
    await writeFile(file, 'old');
    const when = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await utimes(file, when, when);
    await utimes(dir, when, when);

    harness = await makeHarness({
      previewRoot: join(root, 'preview'),
      maintenanceSweepMs: 60 * 60 * 1000,
      derivedRetentionMs: 30 * 24 * 60 * 60 * 1000,
    });
    await vi.advanceTimersByTimeAsync(31_000);
    await vi.waitFor(async () => expect(await readdir(join(root, 'preview'))).toEqual([]));
  });
});
