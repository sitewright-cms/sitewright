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
