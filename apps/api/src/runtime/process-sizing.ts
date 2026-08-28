import { detectMemoryLimit } from './memory-budget.js';

/**
 * How the container's memory is divided between the PROCESSES that share its cgroup.
 *
 * WHY THIS EXISTS. The main process's heap ceiling and the render pool's size used to be derived from
 * the container limit INDEPENDENTLY — the ceiling in docker-entrypoint.sh (65% of the limit), the pool
 * in server.ts — each as though it were the only consumer. They are not: the render workers are
 * separate processes in the SAME cgroup, and so is Chromium when a screenshot runs. Their ceilings
 * therefore SUM to more than the limit, and the kernel enforces the sum.
 *
 * Measured on a 512 MB container at the moment it was SIGKILLed (exit 137) running the API E2E suite:
 *
 *   cgroup anon 416 MB · main process 407 MB (332 MB heap ceiling + ~75 MB native) · worker 126 MB
 *
 * 332 + 126 = 458 MB of a 512 MB budget committed to two processes' ceilings before native
 * allocation, page cache or a browser. The admission ledger did its job — it refused a 12 MB image
 * optimize with `availableMB: 1` — and the container died anyway, because nothing it refuses can
 * shrink a heap ceiling that was already promised. This is that arithmetic, in one place, so the two
 * halves cannot disagree again.
 *
 * Both callers read it: docker-entrypoint.sh (for `--max-old-space-size` on the main process) and
 * server.ts (for the pool). Change a number here and both follow.
 */

/** Per-worker old-space ceiling. Mirrors RenderPool's `memoryLimitMb` default. */
export const WORKER_HEAP_MB = 128;

/**
 * Non-heap cost of a render worker: the Node binary's own mappings, its native deps and stack.
 * Measured at ~25 MB against a 128 MB ceiling; 30 gives a little margin without being generous.
 */
const WORKER_OVERHEAD_MB = 30;

/**
 * Non-heap cost of the MAIN process — libvips, libsql, lightningcss, the HTTP stack, sockets.
 * Measured at ~75 MB (407 MB RSS against a 332 MB ceiling) on a container doing real work.
 */
const MAIN_NATIVE_MB = 80;

/**
 * Slack left to the kernel: page cache, slab, and the allocator's own fragmentation. Proportional
 * rather than fixed, because a big instance caches proportionally more.
 */
const OS_SLACK_FRACTION = 0.05;

/**
 * The ORIGINAL ceiling — 65% of the limit. Kept as an upper bound: on a roomy instance the
 * subtractive figure below is larger than this, and there is no reason to hand V8 a bigger heap than
 * it was ever asked to have. This only ever TIGHTENS the ceiling, never loosens it.
 */
const MAX_HEAP_FRACTION = 0.65;

/** Below this a Node process cannot usefully run, so never derive a ceiling under it. */
const MIN_HEAP_MB = 128;

export interface ProcessSizing {
  /** Ceiling on concurrent render workers. */
  poolSize: number;
  /** Workers kept warm when idle. */
  poolMinSize: number;
  /** Per-worker old-space ceiling (MB). */
  workerHeapMb: number;
  /** Main-process old-space ceiling (MB), with room left for the workers above. */
  mainHeapMb: number;
}

/**
 * Size the pool from the memory this instance actually has, so one image serves a 512 MiB box and an
 * 8 GiB one without hand-tuning. A worker costs ~81 MB resident (measured), so on a small container
 * two of them are a large slice of the budget for something that may never be asked to render.
 * `minSize` stays 0 everywhere except roomy instances: with lazy spawning the only cost of 0 is one
 * fork on the first render.
 */
function poolTier(limitBytes: number): { poolSize: number; poolMinSize: number } {
  const gib = limitBytes / 1024 ** 3;
  if (gib < 1) return { poolSize: 1, poolMinSize: 0 };
  if (gib < 4) return { poolSize: 2, poolMinSize: 0 };
  return { poolSize: 3, poolMinSize: 1 };
}

/**
 * Divide `limitBytes` between the main process and the render workers that share its cgroup.
 *
 * The main heap is whatever is left after the workers' worst case and the main process's own native
 * allocation — capped at {@link MAX_HEAP_FRACTION} so this can only ever tighten the old figure.
 */
export function processSizing(limitBytes: number): ProcessSizing {
  const { poolSize, poolMinSize } = poolTier(limitBytes);
  const limitMb = limitBytes / 1024 / 1024;
  const workersMb = poolSize * (WORKER_HEAP_MB + WORKER_OVERHEAD_MB);
  const available = limitMb - workersMb - MAIN_NATIVE_MB - limitMb * OS_SLACK_FRACTION;
  const mainHeapMb = Math.max(MIN_HEAP_MB, Math.floor(Math.min(limitMb * MAX_HEAP_FRACTION, available)));
  return { poolSize, poolMinSize, workerHeapMb: WORKER_HEAP_MB, mainHeapMb };
}

/** {@link processSizing} for the cgroup this process is actually in. */
export async function processSizingFromCgroup(): Promise<ProcessSizing & { derivedFromHost: boolean }> {
  const { limitBytes, derivedFromHost } = await detectMemoryLimit();
  return { ...processSizing(limitBytes), derivedFromHost };
}

/**
 * CLI for docker-entrypoint.sh: prints the main process's heap ceiling in MB and nothing else, so the
 * shell can put it straight into `--max-old-space-size`. Prints nothing when no container limit is
 * enforced — an uncapped container keeps V8's own default, exactly as before.
 */
if (process.argv[1] && process.argv[1].endsWith('process-sizing.js') && process.argv.includes('--main-heap-mb')) {
  processSizingFromCgroup()
    .then((s) => {
      if (!s.derivedFromHost) process.stdout.write(String(s.mainHeapMb));
    })
    .catch(() => {
      /* the entrypoint falls back to its own arithmetic */
    });
}
