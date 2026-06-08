import type { Binding, Entry } from '@sitewright/schema';

export interface ResolveBindingOptions {
  /** Include `draft` entries (default: published only — drafts are excluded from builds). */
  includeDrafts?: boolean;
}

/**
 * Orders entries by their `order` field (ascending; an absent `order` sorts last, as `+Infinity`),
 * with a stable `id` tie-break. The canonical entry order set by drag-reordering — applied where
 * entries are grouped into the render pool, so both Handlebars `{{#each}}` and block bindings reflect
 * it (an explicit `binding.query.sort` still overrides it in {@link resolveBinding}).
 */
export function compareEntryOrder(a: Entry, b: Entry): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// A reference into the keyed-entry namespace: `item.<dataset>.<key>`. The slug must start with a
// letter (so `item.__proto__` can never name a dataset). `item` must be a ROOT name — not preceded
// by a word char, `.`, or `-` — so `nav-item.x` or `data.item.x` don't false-match. Used to build
// the keyed maps lazily.
const ITEM_REF_RE = /(?<![\w.-])item\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
const DANGEROUS_ID = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Builds the `item` namespace — directly-addressable dataset entries by id, so a template can read
 * `{{item.services.web_development.title}}` WITHOUT looping. Each dataset maps `entry.id → entry.values`
 * (the fields, flat — mirroring how the entry is edited).
 *
 * PERFORMANCE: built ONLY for the datasets a source actually addresses by key (scanned from the
 * template). A source that only loops pays nothing; a keyed source duplicates just the referenced
 * dataset(s) in the render payload — which stays bounded by the route's payload guard. The `data`
 * arrays it reads are the SAME locale-resolved entries `{{#each}}` sees, so keyed and
 * looped access are consistent (incl. draft visibility).
 */
export function keyedDatasets(source: string, data: Record<string, readonly Entry[]>): Record<string, Record<string, unknown>> {
  const slugs = new Set<string>();
  for (const m of source.matchAll(ITEM_REF_RE)) slugs.add(m[1]!);
  if (slugs.size === 0) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const slug of slugs) {
    if (DANGEROUS_ID.has(slug) || !Object.prototype.hasOwnProperty.call(data, slug)) continue;
    const entries = data[slug];
    if (!entries) continue;
    const map: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const e of entries) {
      if (DANGEROUS_ID.has(e.id)) continue;
      map[e.id] = e.values;
    }
    out[slug] = map;
  }
  return out;
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
