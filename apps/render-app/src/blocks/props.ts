import type { Entry } from '@sitewright/schema';

/**
 * Resolves a block prop, supporting CMS data binding: if `props["<key>Field"]`
 * names a dataset field and an `entry` is in context, the entry's value wins;
 * otherwise the static `props[key]` is used.
 */
export function fieldValue(
  props: Record<string, unknown>,
  entry: Entry | undefined,
  key: string,
): unknown {
  const fieldRef = props[`${key}Field`];
  if (entry && typeof fieldRef === 'string') {
    return entry.values[fieldRef];
  }
  return props[key];
}

/** Coerces an unknown value to a string, falling back when it is not a string. */
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Reads a string prop (with optional field binding) in one step. */
export function textProp(
  props: Record<string, unknown>,
  entry: Entry | undefined,
  key: string,
  fallback = '',
): string {
  return str(fieldValue(props, entry, key), fallback);
}

// Allow only absolute http(s) URLs, root-relative paths, fragment links, and empty.
// Blocks `javascript:`, `data:`, `vbscript:`, and other active/unknown schemes that
// would become XSS or unwanted fetches when emitted into an href/src attribute.
// The root-relative branch requires a single leading `/` NOT followed by another
// `/`, so protocol-relative URLs (`//evil.com`, an off-site/open-redirect vector)
// are rejected. Mirrors packages/blocks/src/url.ts (incl. mailto/tel/sms handlers).
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|sms:|\/(?!\/)|#)/i;

/** Sanitizes a URL string for use in `href`/`src`; returns `fallback` if unsafe. */
export function safeUrl(value: string, fallback = '#'): string {
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  return SAFE_URL.test(trimmed) ? trimmed : fallback;
}

/** Reads a URL prop (with optional field binding) and sanitizes it. */
export function urlProp(
  props: Record<string, unknown>,
  entry: Entry | undefined,
  key: string,
  fallback = '#',
): string {
  return safeUrl(str(fieldValue(props, entry, key)), fallback);
}
