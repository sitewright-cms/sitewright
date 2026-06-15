import type { Entry } from '@sitewright/schema';

/**
 * Orders entries by their `order` field (ascending; an absent `order` sorts last, as `+Infinity`),
 * with a stable `id` tie-break. The canonical entry order set by drag-reordering — applied where
 * entries are grouped into the render pool, so Handlebars `{{#each}}` reflects it.
 */
export function compareEntryOrder(a: Entry, b: Entry): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// A reference into the keyed-entry namespace: `item.<dataset>.<key>`. The slug must start with a
// letter (so `item.__proto__` can never name a dataset). `item` must be a ROOT name — not preceded
// by a word char, `.`, or `-` — so `nav-item.x` or `dataset.item.x` don't false-match — EXCEPT the
// explicit `@root.item.…` form, which is how a template reaches the namespace from inside an
// `{{#each}}` scope (e.g. `(lookup @root.item.team manager)`) and must build the map too. Used to
// build the keyed maps lazily.
const ITEM_REF_RE = /(?:@root\.|(?<![\w.-]))item\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
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

