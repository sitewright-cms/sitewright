import type { ImageVariant } from './types.js';

/**
 * Builds a `srcset` string for one format from a set of variants, optionally
 * prefixing each path with a base URL/path (a trailing slash is added if needed).
 * Note: `basePath` is emitted verbatim — callers must ensure it is HTML-safe
 * before inserting the result into a `srcset` attribute.
 */
export function buildSrcset(
  variants: readonly ImageVariant[],
  format: 'avif' | 'webp',
  basePath = '',
): string {
  const base = basePath && !basePath.endsWith('/') ? `${basePath}/` : basePath;
  return variants
    .filter((variant) => variant.format === format)
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${base}${variant.path} ${variant.width}w`)
    .join(', ');
}
