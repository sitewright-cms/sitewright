import { SLOT_MAX } from '@sitewright/schema';
import type { ImportLimits } from './types.js';

/**
 * Engine defaults. The page-source / slot caps track the schema's own bounds (`PageSchema.source` 256 KiB,
 * `WebsiteSettings` slots = SLOT_MAX) so the engine drops a fragment BEFORE the schema would reject it — a
 * hoisted header/footer at the slot cap must NOT be silently dropped for being over an out-of-date local
 * limit. Page/image counts are conservative ceilings.
 */
export const DEFAULT_LIMITS: ImportLimits = {
  maxPages: 200,
  maxSourceBytes: 256 * 1024,
  maxImages: 500,
  maxSlotBytes: SLOT_MAX,
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
