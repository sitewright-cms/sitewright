import type { ImageVariant } from './types.js';

/**
 * Builds a `srcset` string for one format from a set of variants, optionally
 * prefixing each path with a base URL/path.
 */
export function buildSrcset(
  variants: readonly ImageVariant[],
  format: 'avif' | 'webp',
  basePath = '',
): string {
  return variants
    .filter((variant) => variant.format === format)
    .sort((a, b) => a.width - b.width)
    .map((variant) => `${basePath}${variant.path} ${variant.width}w`)
    .join(', ');
}
