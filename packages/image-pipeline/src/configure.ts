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
 * Thread concurrency is left alone: it measured 1 already, so there is nothing to win and forcing a
 * number would only risk making encodes slower on a roomy host.
 */
export interface ImagePipelineLimits {
  /** libvips operation cache, in MB. 0 disables it entirely. */
  cacheMb: number;
}

/** Derive cache size from the container's memory ceiling. */
export function imagePipelineLimitsFor(limitBytes: number): ImagePipelineLimits {
  const gib = limitBytes / 1024 ** 3;
  // Under 1 GiB every megabyte is contested and the disk cache already covers the real access
  // pattern; above that, keep a small cache for burst work but never the stock 50 MB.
  if (gib < 1) return { cacheMb: 0 };
  if (gib < 4) return { cacheMb: 16 };
  return { cacheMb: 32 };
}

/** Apply the limits. Safe to call once at boot; later calls simply re-set the same knobs. */
export function configureImagePipeline(limits: ImagePipelineLimits): void {
  sharp.cache(limits.cacheMb <= 0 ? false : { memory: limits.cacheMb, files: 8, items: 50 });
}
