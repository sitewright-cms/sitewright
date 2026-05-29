import type { Binding, Entry } from '@sitewright/schema';

export interface ResolveBindingOptions {
  /** Include `draft` entries (default: published only — drafts are excluded from builds). */
  includeDrafts?: boolean;
}

/**
 * Resolves a binding against a pool of dataset entries, returning the entries to
 * render. Bindings are resolved at **build time**.
 *
 * Only entries whose `dataset` matches the binding are considered, and (by
 * default) only published ones. The binding's query applies `where` equality
 * filters and an optional `sort`. Sorting is deterministic and
 * locale-independent (Unicode code-point order for strings, numeric order for
 * numbers) with a stable tie-break on `entry.id`, so builds are reproducible
 * across machines. `mode: 'single'` returns at most one entry; `mode: 'list'`
 * applies `binding.limit`.
 */
export function resolveBinding(
  binding: Binding,
  entries: readonly Entry[],
  options: ResolveBindingOptions = {},
): Entry[] {
  let result = entries.filter((entry) => entry.dataset === binding.dataset);

  if (!options.includeDrafts) {
    result = result.filter((entry) => entry.status === 'published');
  }

  const where = binding.query?.where;
  if (where) {
    const filters = Object.entries(where);
    result = result.filter((entry) =>
      filters.every(([field, expected]) => valuesEqual(readValue(entry.values, field), expected)),
    );
  }

  const sort = binding.query?.sort;
  if (sort) {
    const field = sort.field;
    const direction = sort.dir === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const primary = compareValues(readValue(a.values, field), readValue(b.values, field)) * direction;
      return primary !== 0 ? primary : compareStrings(a.id, b.id);
    });
  }

  if (binding.mode === 'single') return result.slice(0, 1);
  if (binding.limit !== undefined) return result.slice(0, binding.limit);
  return result;
}

/**
 * Own-enumerable value read that avoids dynamic object indexing. Field names are
 * already identifier-validated upstream, but reading via `values[field]` would
 * still surface inherited prototype members (e.g. a `constructor` sort field);
 * this lookup only sees the entry's own keys.
 */
function readValue(values: Record<string, unknown>, field: string): unknown {
  return Object.entries(values).find(([key]) => key === field)?.[1];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      // Circular references / BigInt — treat as not equal rather than throwing.
      return false;
    }
  }
  return false;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return compareStrings(String(a ?? ''), String(b ?? ''));
}

/** Deterministic, locale-independent string comparison (Unicode code-point order). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
