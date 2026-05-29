// Mirrors apps/render-app/src/blocks/props.ts (text/field resolution). Kept here
// so the shared renderer is self-contained; Phase F converges the Astro renderer
// onto this package and removes the duplicate.
import type { Entry } from '@sitewright/schema';
import { safeUrl } from './url.js';

/** Own-enumerable property read that avoids dynamic object indexing. */
function read(obj: Record<string, unknown>, key: string): unknown {
  return Object.entries(obj).find(([k]) => k === key)?.[1];
}

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
  const fieldRef = read(props, `${key}Field`);
  if (entry && typeof fieldRef === 'string') {
    return read(entry.values, fieldRef);
  }
  return read(props, key);
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

/** Reads a URL prop (with optional field binding) and sanitizes it. */
export function urlProp(
  props: Record<string, unknown>,
  entry: Entry | undefined,
  key: string,
  fallback = '#',
): string {
  return safeUrl(str(fieldValue(props, entry, key)), fallback);
}
