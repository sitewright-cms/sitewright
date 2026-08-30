import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const ENTRYPOINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docker-entrypoint.sh');

/**
 * The container entrypoint decides three things no test could otherwise see: the allocator, its decay
 * behaviour, and V8's heap ceiling. It had no coverage, and its last two bugs were both "a value that
 * looked set but was inert" — MALLOC_ARENA_MAX under jemalloc, and a heap ceiling derived from host
 * RAM. The script ends in `exec "$@"`, so running it with `env` prints exactly the environment the
 * app would start with.
 */
async function entrypointEnv(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { stdout } = await run('sh', [ENTRYPOINT, 'env'], {
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      // A clean slate: the script only sets what the operator has not.
      ...extra,
    },
  });
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe('docker-entrypoint: allocator + diagnostics', () => {
  it('shortens jemalloc\'s decay windows so pages come back sooner after a burst', async () => {
    const env = await entrypointEnv();
    expect(env.MALLOC_CONF).toContain('dirty_decay_ms:');
    expect(env.MALLOC_CONF).toContain('muzzy_decay_ms:');
  });

  it('★ never enables background_thread — it deadlocks the forks this process lives on', async () => {
    const env = await entrypointEnv();
    // jemalloc's background thread and fork() interact badly: a child forked while that thread holds
    // an internal lock can stall between fork and exec. This process forks constantly (render workers,
    // Chrome for screenshots and Lighthouse). MEASURED on an idle 1GiB slot: with background_thread
    // the pagespeed audit failed 3/3 with `connect ECONNREFUSED` after a 25s launch timeout; without
    // it, 3/3 passed in 6s. It is the obvious way to make idle purging work and it must not be used.
    expect(env.MALLOC_CONF).not.toContain('background_thread:true');
  });

  it('lets the operator override MALLOC_CONF entirely', async () => {
    const env = await entrypointEnv({ MALLOC_CONF: 'background_thread:false' });
    expect(env.MALLOC_CONF).toBe('background_thread:false');
  });

  it('leaves heap snapshots DISARMED by default', async () => {
    const env = await entrypointEnv();
    // Writing one pauses the process and costs a heap-sized file — never a default on a live instance.
    expect(env.NODE_OPTIONS ?? '').not.toContain('heapsnapshot-signal');
  });

  it('arms the SIGUSR2 heap snapshot when asked, without dropping an existing NODE_OPTIONS', async () => {
    const armed = await entrypointEnv({ SW_HEAPSNAPSHOT: '1', NODE_OPTIONS: '--max-old-space-size=256' });
    expect(armed.NODE_OPTIONS).toContain('--max-old-space-size=256'); // operator's value survives
    expect(armed.NODE_OPTIONS).toContain('--heapsnapshot-signal=SIGUSR2');
  });

  it('treats SW_HEAPSNAPSHOT=0 as off, not as "set"', async () => {
    const env = await entrypointEnv({ SW_HEAPSNAPSHOT: '0' });
    expect(env.NODE_OPTIONS ?? '').not.toContain('heapsnapshot-signal');
  });

  it('does not clobber an operator-chosen NODE_OPTIONS with a derived heap ceiling', async () => {
    const env = await entrypointEnv({ NODE_OPTIONS: '--max-old-space-size=123' });
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=123');
  });
});
