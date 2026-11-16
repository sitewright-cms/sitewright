import { availableParallelism } from 'node:os';
import sharp from 'sharp';

/**
 * Bound libvips' own caches to the memory this instance actually has.
 *
 * sharp ships a 50 MB operation cache (plus 20 open files / 100 items) and nothing here ever
 * configured it — measured on a running container: `{"memory":{"max":50},"files":{"max":20},
 * "items":{"max":100}}`. That cache is retained AFTER image work finishes, so on a small container
 * it is a permanent slice of the budget held for a speed-up that mostly benefits repeated work on
 * the same source image — which is not this workload's shape (a variant is generated once, then
 * served from disk by the thumbnail cache).
 *
 * ★ And bound the THREADS each operation runs. With jemalloc preloaded (the container's allocator)
 * sharp leaves libvips at one worker thread per HOST core — 20 on the measuring host, whatever the
 * container's CPU quota — and every thread holds its own buffers. MEASURED in a 6-CPU, 1.5 GiB
 * container, six concurrent encodes of 24MP photos: WebP +1,286 MB at 20 threads, +587 MB at 2, and 2
 * was FASTER (16.6 vs 14.8 encodes/s); AVIF +1,044 vs +959 MB, 0.62 vs 0.72/s. Image work here is
 * parallel ACROSS operations (several builds, several variants), so per-operation threads only add
 * memory. (An older note here said concurrency "measured 1": that was a `docker exec` shell, which
 * does not preload jemalloc — sharp picks 1 thread for glibc and the core count for jemalloc.)
 */
export interface ImagePipelineLimits {
  /** libvips operation cache, in MB. 0 disables it entirely. */
  cacheMb: number;
  /** libvips worker threads per operation. Omitted → left as it is. */
  threads?: number;
}

/** Threads per image operation: enough for one AVIF encode to use two cores, no more (see above). */
export const IMAGE_THREADS_MAX = 2;

/** Derive cache size from the container's memory ceiling, and threads from its CPUs (quota-aware). */
export function imagePipelineLimitsFor(limitBytes: number, cpus: number = availableParallelism()): ImagePipelineLimits {
  const gib = limitBytes / 1024 ** 3;
  const threads = Math.max(1, Math.min(IMAGE_THREADS_MAX, Math.floor(cpus)));
  // Under 1 GiB every megabyte is contested and the disk cache already covers the real access
  // pattern; above that, keep a small cache for burst work but never the stock 50 MB.
  if (gib < 1) return { cacheMb: 0, threads };
  if (gib < 4) return { cacheMb: 16, threads };
  return { cacheMb: 32, threads };
}

/** Apply the limits. Safe to call once at boot; later calls simply re-set the same knobs. */
export function configureImagePipeline(limits: ImagePipelineLimits): void {
  sharp.cache(limits.cacheMb <= 0 ? false : { memory: limits.cacheMb, files: 8, items: 50 });
  if (limits.threads !== undefined && Number.isInteger(limits.threads) && limits.threads > 0) sharp.concurrency(limits.threads);
}
