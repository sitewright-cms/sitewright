// Multilingual content model (document-level, code-inheritance) — see
// docs/i18n-content-model.md. A locale variant of a page is itself a Page (own
// path/title/seo/data) linked to its siblings by `translationGroup`. By default a
// variant INHERITS the main language's page code (carries no `source`/`template`,
// resolves the owner's via `resolveCodeRef`); it can instead FORK its own `source`
// or reference a `template`. Datasets are duplicated per locale (`<slug>-<locale>`)
// and resolved here by an auto locale-suffix convention, with explicit
// `<slug>-<locale>` addressing still available.
import type { Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';

/**
 * The dataset slug a base name resolves to in `locale` — a slug-valid hyphen suffix
 * with the locale lowercased (`services` + `de` → `services-de`; `pt-BR` → `services-pt-br`),
 * so it satisfies `SlugSchema` for every locale tag.
 */
export function localizedDatasetName(name: string, locale: string): string {
  return `${name}-${locale.toLowerCase()}`;
}

/**
 * Returns a view of the dataset map for the active `locale`: a base name `<s>`
 * resolves to `<s>-<locale>` when that dataset exists (auto-suffix), otherwise
 * stays itself (fallback to the default-locale dataset). The original suffixed
 * keys remain addressable, so `{{#each data.services-de}}` still works as a
 * manual escape hatch. The default locale (no `-<locale>` variants) is unchanged.
 */
export function resolveLocaleDatasets<T>(
  datasets: Record<string, readonly T[]>,
  locale: string | undefined,
): Record<string, readonly T[]> {
  if (!locale) return datasets;
  const suffix = `-${locale.toLowerCase()}`;
  const out: Record<string, readonly T[]> = { ...datasets };
  for (const name of Object.keys(datasets)) {
    // Don't re-suffix a name that is already a variant for THIS locale.
    if (name.endsWith(suffix)) continue;
    const localized = localizedDatasetName(name, locale);
    if (Object.prototype.hasOwnProperty.call(datasets, localized)) {
      out[name] = datasets[localized]!;
    }
  }
  return out;
}

/** A page's effective locale: its own `locale`, or the project default when unset. */
export function localeOf(page: Pick<Page, 'locale'>, defaultLocale: string): string {
  return page.locale ?? defaultLocale;
}

/**
 * The subset of `pages` belonging to `locale` — used to build a per-locale nav so a
 * menu lists only the pages that exist in that language. Default-locale pages carry
 * no explicit `locale`, so they match when `locale === defaultLocale`.
 */
export function pagesInLocale<T extends Pick<Page, 'locale'>>(
  pages: readonly T[],
  locale: string,
  defaultLocale: string,
): T[] {
  return pages.filter((p) => localeOf(p, defaultLocale) === locale);
}

/** One member of a translation group, for a language switcher. */
export interface TranslationLink {
  locale: string;
  path: string;
  title: string;
}

/**
 * The locale variants of `page` (its translation group, including the page
 * itself), as `{ locale, path, title }`, sorted by locale. `defaultLocale`
 * fills in a member whose `locale` is unset. Empty when the page has no
 * `translationGroup` (it stands alone → no alternates / switcher).
 */
export function translationsOf(
  pages: readonly Page[],
  page: Page,
  defaultLocale: string,
): TranslationLink[] {
  if (!page.translationGroup) return [];
  const byId = pagesById(pages);
  return pages
    .filter((p) => p.translationGroup === page.translationGroup && !p.collection)
    .map((p) => ({ locale: p.locale ?? defaultLocale, path: pagePath(p, byId), title: p.title }))
    .sort((a, b) => a.locale.localeCompare(b.locale, 'en'));
}

// ---------------------------------------------------------------------------
// Code inheritance (locale variants follow the main language's page code).
//
// A locale variant of a page can be in one of three CODE MODES:
//   - inherit  → carries neither `source` nor `template`; renders the code of its
//                translation group's DEFAULT-LOCALE owner (edit the main page's
//                layout once → every inheriting locale follows, no sync).
//   - fork     → carries its own `source` (per-locale layout, edited freely).
//   - template → references a project/global `template`.
// Only `data` (+ path/title/seo/nav) differs per locale in inherit mode.
// See docs/i18n-content-model.md.
// ---------------------------------------------------------------------------

/** A page's resolved code reference: an inline `source` or a `template` ref. */
export interface CodeRef {
  source?: string;
  template?: string;
}

/** The page's code mode (see above). `inherit` = no own code → follows the owner. */
export type PageCodeMode = 'inherit' | 'fork' | 'template';

/** Whether a page carries its OWN code (a forked `source` or an assigned `template`). An
 *  EMPTY source counts as no code — the editor sends `source: ''` for code-less pages, and a
 *  blank body should inherit rather than render nothing (mirrors the prior `source || template`). */
export function hasOwnCode(page: Pick<Page, 'source' | 'template'>): boolean {
  return Boolean(page.source) || Boolean(page.template);
}

/** Classify a page's code mode. */
export function pageCodeMode(page: Pick<Page, 'source' | 'template'>): PageCodeMode {
  if (page.template) return 'template';
  if (page.source) return 'fork';
  return 'inherit';
}

/**
 * The default-locale "code owner" of a page's translation group — the page whose
 * `source`/`template` an inherit-mode variant follows. Undefined when the page has
 * no `translationGroup`, or the group has no default-locale member (a locale-only
 * page, which must therefore carry its own code).
 */
export function codeOwnerOf(
  page: Pick<Page, 'translationGroup'>,
  pages: readonly Page[],
  defaultLocale: string,
): Page | undefined {
  if (!page.translationGroup) return undefined;
  return pages.find(
    (p) => p.translationGroup === page.translationGroup && localeOf(p, defaultLocale) === defaultLocale,
  );
}

/**
 * Resolve a page's effective code reference: its own `source`/`template` when set,
 * otherwise (inherit mode) the code of its translation-group owner. A page that
 * inherits but has no resolvable owner returns an empty ref — the caller falls back
 * to the legacy block tree (a blank body would be a silent failure otherwise).
 */
export function resolveCodeRef(page: Page, pages: readonly Page[], defaultLocale: string): CodeRef {
  // Precedence: a `template` ref WINS over `source` (matches `pageCodeMode` + the editor's
  // template lock — the editor keeps the old source in state when a template is assigned).
  // Truthy checks: an EMPTY `source` ('' — what the editor sends for a code-less page) counts
  // as no own code, so the page inherits rather than rendering a blank body.
  if (page.template) return { template: page.template };
  if (page.source) return { source: page.source };
  const owner = codeOwnerOf(page, pages, defaultLocale);
  if (owner && owner.id !== page.id) {
    if (owner.template) return { template: owner.template };
    if (owner.source) return { source: owner.source };
  }
  return {};
}

/** Whether `page` is the default-locale owner of a group that has other members
 * (deleting it cascades the inherit-mode variants — see {@link inheritingVariants}). */
export function isCodeOwner(page: Page, pages: readonly Page[], defaultLocale: string): boolean {
  if (!page.translationGroup || localeOf(page, defaultLocale) !== defaultLocale) return false;
  return pages.some((p) => p.id !== page.id && p.translationGroup === page.translationGroup);
}

/** Group members (excluding `owner`) that INHERIT the owner's code — they cannot
 * stand without it, so deleting the owner cascades these. */
export function inheritingVariants(owner: Page, pages: readonly Page[]): Page[] {
  if (!owner.translationGroup) return [];
  return pages.filter(
    (p) => p.id !== owner.id && p.translationGroup === owner.translationGroup && !hasOwnCode(p),
  );
}

/** Group members (excluding `owner`) that carry their OWN code (forked/template) —
 * self-sufficient, so deleting the owner KEEPS these (merely detaching them). */
export function independentVariants(owner: Page, pages: readonly Page[]): Page[] {
  if (!owner.translationGroup) return [];
  return pages.filter(
    (p) => p.id !== owner.id && p.translationGroup === owner.translationGroup && hasOwnCode(p),
  );
}

// ---------------------------------------------------------------------------
// Locale scaffolding (duplicate the default-locale pages into a new locale).
// ---------------------------------------------------------------------------

/** Deep-clone a JSON-safe sub-value (page.data/seo/nav/collection/root are all JSON). */
function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The locale variant of the site's HOME page (the root of a locale's subtree), if it exists. */
function localeHomeFor(pages: readonly Page[], locale: string, defaultLocale: string): Page | undefined {
  const home = pages.find((p) => p.path === '' && localeOf(p, defaultLocale) === defaultLocale);
  if (!home) return undefined;
  const group = home.translationGroup ?? home.id;
  return pages.find((p) => (p.translationGroup ?? p.id) === group && localeOf(p, defaultLocale) === locale);
}

/**
 * Build a single inherit-mode locale variant of `owner` for `locale`, resolving its
 * parent against `pages` (existing variants): the home's variant nests under the ROOT
 * home (route `/<locale>`); every other variant nests under its parent's variant in the
 * same locale (route `/<locale>/…`), falling back to the locale home. The variant copies
 * `data`/`seo`/`nav`/`order`/`collection`/`status`/`title` but OMITS `source`/`template`
 * (so its code follows the owner). `id` follows the `<ownerId>-<locale>` convention,
 * uniquified against existing ids.
 */
export function buildLocaleVariant(
  owner: Page,
  locale: string,
  pages: readonly Page[],
  defaultLocale: string,
): Page {
  const byId = pagesById(pages);
  const group = owner.translationGroup ?? owner.id;
  const isHome = owner.path === '';

  const existing = new Set(pages.map((p) => p.id));
  let id = `${owner.id}-${locale}`;
  for (let n = 2; existing.has(id); n += 1) id = `${owner.id}-${locale}-${n}`;

  let parent: string | undefined;
  if (isHome) {
    parent = pages.find((p) => p.path === '' && localeOf(p, defaultLocale) === defaultLocale)?.id;
  } else {
    const parentOwner = owner.parent ? byId.get(owner.parent) : undefined;
    if (parentOwner && parentOwner.path !== '') {
      const pg = parentOwner.translationGroup ?? parentOwner.id;
      parent =
        pages.find((p) => (p.translationGroup ?? p.id) === pg && localeOf(p, defaultLocale) === locale)?.id ??
        localeHomeFor(pages, locale, defaultLocale)?.id;
    } else {
      parent = localeHomeFor(pages, locale, defaultLocale)?.id;
    }
  }

  const variant: Page = {
    id,
    // The home variant's slug is the locale code (lowercased to satisfy the slug schema for
    // mixed-case tags like `pt-BR`); every other variant keeps the owner's slug.
    path: isHome ? locale.toLowerCase() : owner.path,
    title: owner.title,
    locale,
    translationGroup: group,
    root: cloneJson(owner.root),
  };
  if (parent !== undefined) variant.parent = parent;
  if (owner.status !== undefined) variant.status = owner.status;
  if (owner.seo !== undefined) variant.seo = cloneJson(owner.seo);
  if (owner.nav !== undefined) variant.nav = cloneJson(owner.nav);
  if (owner.order !== undefined) variant.order = owner.order;
  if (owner.data !== undefined) variant.data = cloneJson(owner.data);
  if (owner.collection !== undefined) variant.collection = cloneJson(owner.collection);
  return variant;
}

/** The result of scaffolding a locale: new variant pages plus owner pages that need
 * their `translationGroup` set (so the group links). */
export interface LocaleScaffold {
  /** New inherit-mode locale-variant pages to create. */
  created: Page[];
  /** Existing default-locale pages updated to carry the shared `translationGroup`. */
  updated: Page[];
}

/** Depth of a page in the tree (root = 0), cycle-safe — for parent-before-child ordering. */
function treeDepth(page: Page, byId: ReadonlyMap<string, Page>): number {
  let depth = 0;
  const seen = new Set<string>();
  let cur: Page | undefined = page;
  while (cur?.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parent);
    depth += 1;
  }
  return depth;
}

/**
 * Duplicate every DEFAULT-LOCALE page into `locale` as an inherit-mode variant — the
 * whole-site scaffold run when a translation target is added. The locale subtree mirrors
 * the default tree under `/<locale>/…`; each variant copies the owner's `data`/settings
 * but follows the owner's code (no `source`/`template`). Returns the variants to create
 * plus the owners that gained a `translationGroup`. Pure — performs no I/O. Re-running for
 * a locale that already has variants is the caller's responsibility to avoid (guarded at
 * the API).
 */
export function scaffoldLocale(pages: readonly Page[], locale: string, defaultLocale: string): LocaleScaffold {
  const owners = pages.filter((p) => localeOf(p, defaultLocale) === defaultLocale);
  const byId = pagesById(pages);
  // Parents before children so each child's parent variant already exists when we resolve it.
  const sorted = [...owners].sort((a, b) => treeDepth(a, byId) - treeDepth(b, byId));

  let working: Page[] = [...pages];
  const created: Page[] = [];
  const updated: Page[] = [];
  for (const owner of sorted) {
    let workingOwner = owner;
    if (!owner.translationGroup) {
      workingOwner = { ...owner, translationGroup: owner.id };
      updated.push(workingOwner);
      working = working.map((p) => (p.id === workingOwner.id ? workingOwner : p));
    }
    const variant = buildLocaleVariant(workingOwner, locale, working, defaultLocale);
    created.push(variant);
    working = [...working, variant];
  }
  return { created, updated };
}

/**
 * Inherit-mode variants of a single default-locale `owner` for the target `locales` it does
 * not yet exist in — the "make this new page available in all languages" propagation. Ensures
 * the owner's whole ANCESTOR chain exists in each target locale FIRST (so a page never nests
 * under a missing parent): it walks `owner` up to the root home, then creates a variant for
 * every ancestor — excluding the root home, whose variant is the locale home — and finally the
 * owner, top-down so each child's parent variant already exists. Skips the default locale and
 * any (ancestor or owner) already present in its group. Also links owners that lacked a
 * `translationGroup`.
 */
export function propagatePageToLocales(
  owner: Page,
  pages: readonly Page[],
  locales: readonly string[],
  defaultLocale: string,
): LocaleScaffold {
  const byId = pagesById(pages);
  // The owner's ancestor chain (default-locale pages), root-most → owner, EXCLUDING the root
  // home (path ''). Every entry must exist in a target locale before the owner can nest.
  const chain: Page[] = [];
  const seen = new Set<string>();
  let cur: Page | undefined = owner;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.path !== '') chain.unshift(cur);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }

  const created: Page[] = [];
  const updated: Page[] = [];
  let working: Page[] = [...pages];
  // Returns the working copy of `node`, linking it into its own group if it had none.
  const linkGroup = (node: Page): Page => {
    if (node.translationGroup) return node;
    const existing = updated.find((u) => u.id === node.id);
    if (existing) return existing;
    const linked = { ...node, translationGroup: node.id };
    updated.push(linked);
    working = working.map((p) => (p.id === linked.id ? linked : p));
    return linked;
  };

  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    for (const node of chain) {
      const linked = linkGroup(node);
      const groupId = linked.translationGroup ?? linked.id;
      const present = working.some(
        (p) => (p.translationGroup ?? p.id) === groupId && localeOf(p, defaultLocale) === locale,
      );
      if (present) continue;
      const variant = buildLocaleVariant(linked, locale, working, defaultLocale);
      created.push(variant);
      working = [...working, variant];
    }
  }
  return { created, updated };
}
