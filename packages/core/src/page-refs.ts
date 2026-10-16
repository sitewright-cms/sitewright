// Resolving a dataset's `page`-typed fields into readable page attributes.
//
// A `page` field STORES a page id, because that is the only value that survives the page being
// renamed, moved under a different parent, or re-slugged — the reference follows it. But an id is
// useless to a template: `{{#each dataset.links}}{{target}}{{/each}}` would print `pg_7f3a`. So the
// render projection swaps the id for the page's ATTRIBUTES on the way in, and the loop reads what it
// obviously wants:
//
//   {{#each dataset.promos}}
//     <a href="{{sw-url target.path}}">{{target.title}}</a>
//   {{/each}}
//
// This is the ONE place that mapping happens, and every render surface — the editor preview, the code
// editor's render-template and the publish build — calls it right after `resolveLocaleDatasets`, with
// the same published page set. A resolution wired into only some of them, or fed different pages,
// renders a loop correctly on one surface and blank (or differently linked) on another.
import type { Dataset, Entry, Field, Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';
import { localeVariantOf } from './i18n.js';

/** What a `page` field reads as in a template — the lean always-present attributes of a page.
 *  Deliberately the SAME field names `pages.<slug>._attributes` uses, so one spelling is learned once. */
export interface PageRefView {
  id: string;
  title: string;
  /** The page's own slug segment (`''` for a locale home). */
  slug: string;
  /** The full root-relative route — what {{sw-url}} takes. */
  path: string;
  locale: string;
  description: string;
  image: string;
}

/** Depth guard mirroring the schema's own MAX_FIELD_DEPTH — a field tree cannot nest deeper. */
const MAX_DEPTH = 4;

/** Does this field tree contain a `page` field anywhere? The cheap gate that keeps an ordinary
 *  dataset (the overwhelming majority) from being walked or copied at all. */
export function hasPageField(fields: readonly Field[] | undefined, depth = 0): boolean {
  if (!fields || depth >= MAX_DEPTH) return false;
  return fields.some((f) => f.type === 'page' || hasPageField(f.fields, depth + 1));
}

/** Where a stored id is read: the page index, plus the reader's locale when the surface has one. */
interface RefScope {
  byId: Map<string, Page>;
  pages: readonly Page[];
  defaultLocale: string;
  locale?: string;
}

/** The attributes view of a page, or undefined when the id resolves to nothing (a deleted page). With a
 *  locale, the page's member of its translation group in that locale (else the stored page itself). */
function viewOf(id: unknown, scope: RefScope): PageRefView | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  const { byId, pages, defaultLocale, locale } = scope;
  const stored = byId.get(id);
  if (!stored) return undefined;
  const page = locale === undefined ? stored : (localeVariantOf(stored, pages, locale, defaultLocale) ?? stored);
  return {
    id: page.id,
    title: page.title,
    slug: page.path,
    path: pagePath(page, byId),
    locale: page.locale ?? defaultLocale,
    description: page.description ?? '',
    image: page.image ?? '',
  };
}

/** Replace the `page`-typed leaves of one values object, recursing into `object` groups and `list` items. */
function resolveValues(
  values: Record<string, unknown>,
  fields: readonly Field[],
  scope: RefScope,
  depth: number,
): Record<string, unknown> {
  if (depth >= MAX_DEPTH) return values;
  const out: Record<string, unknown> = { ...values };
  for (const field of fields) {
    // eslint-disable-next-line security/detect-object-injection -- `field.name` comes from the stored
    // dataset SCHEMA (KeyNameSchema-validated), and `out` is a fresh object, not a prototype.
    const value = out[field.name];
    if (field.type === 'page') {
      // An unresolvable id reads as EMPTY rather than as the raw id: a dangling reference should leave
      // a blank in the page, never a link to a 404 or a stray `pg_7f3a` in the copy.
      out[field.name] = viewOf(value, scope);
      continue;
    }
    if (!field.fields) continue;
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      out[field.name] = resolveValues(value as Record<string, unknown>, field.fields, scope, depth + 1);
    } else if (field.type === 'list' && Array.isArray(value)) {
      out[field.name] = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? resolveValues(item as Record<string, unknown>, field.fields!, scope, depth + 1)
          : item,
      );
    }
  }
  return out;
}

/**
 * Swap every `page` field's stored id for its {@link PageRefView}, across a whole dataset map.
 *
 * Returns the SAME object when no dataset in the project declares a `page` field, so the common case
 * costs one schema scan and copies nothing. `pages` must be the PUBLISHED subset (`publishedPages`) on
 * EVERY surface — the publish build, the editor preview and render-template alike — because a
 * reference to a page that isn't in it resolves to empty, and that is the honest answer: on the live
 * site a draft page is not there. A preview resolving against drafts too shows a working link the
 * published site renders empty (and, for a draft translation, the wrong locale's page). Draft ENTRIES
 * are a separate rule: the previews keep showing them; only the pages a reference can land on are
 * filtered.
 *
 * `locale` is the READER's — the page being rendered. A field stores one id (usually the main-language
 * page, because that is what the editor's picker offers), and a German reader must land on the German
 * page, exactly as the per-locale nav does; a page with no variant in that locale resolves as itself.
 */
export function resolveDatasetPageRefs<E extends Entry>(
  datasets: Record<string, readonly E[]>,
  schemas: readonly Dataset[],
  pages: readonly Page[],
  defaultLocale: string,
  locale?: string,
): Record<string, readonly E[]> {
  // A dataset's LOCALE variants (`services_de`) are separate entities with their own schema rows, but a
  // project may also carry only the base schema; match on the exact slug and fall back to the base name.
  const withPageFields = new Map<string, readonly Field[]>();
  for (const ds of schemas) if (hasPageField(ds.fields)) withPageFields.set(ds.slug, ds.fields);
  if (withPageFields.size === 0) return datasets;

  const scope: RefScope = { byId: pagesById(pages), pages, defaultLocale, locale };
  const out: Record<string, readonly E[]> = {};
  for (const [slug, entries] of Object.entries(datasets)) {
    const fields = withPageFields.get(slug) ?? withPageFields.get(slug.replace(/_[a-z0-9_]+$/, ''));
    if (!fields) {
      // eslint-disable-next-line security/detect-object-injection -- `slug` is a key of the input map
      out[slug] = entries;
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- as above; `out` is a fresh object
    out[slug] = entries.map((e) => ({
      ...e,
      values: resolveValues((e.values ?? {}) as Record<string, unknown>, fields, scope, 0),
    }));
  }
  return out;
}
