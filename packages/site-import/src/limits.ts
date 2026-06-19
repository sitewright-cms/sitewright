import type { ImportLimits } from './types.js';

/**
 * Engine defaults. The page-source / slot / CSS caps mirror the schema's own bounds
 * (`PageSchema.source` 256 KiB, `WebsiteSettings` slots 20 KB, `criticalCss` 10 KB) so the
 * engine trims BEFORE the schema would reject. Page/image counts are conservative ceilings.
 */
export const DEFAULT_LIMITS: ImportLimits = {
  maxPages: 200,
  maxSourceBytes: 256 * 1024,
  maxImages: 500,
  maxSlotBytes: 20_000,
  maxCriticalCssBytes: 10_000,
  maxHeadCssBytes: 20_000,
};

/** Merge caller overrides over the defaults (undefined fields fall back to the default). */
export function resolveLimits(overrides?: Partial<ImportLimits>): ImportLimits {
  return { ...DEFAULT_LIMITS, ...stripUndefined(overrides) };
}

function stripUndefined<T extends object>(obj?: T): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}
