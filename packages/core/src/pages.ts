import type { JsonValue, Page } from '@sitewright/schema';
import { pagesById, pagePath } from './routes.js';
import { localeOf, localeHomeFor } from './i18n.js';

// The `pages` namespace: cross-page DIRECT access by slug path, rooted at the CURRENT page's locale
// HOME and walked by slug — `{{ pages.services.seo.data.header_title }}` reads the /services/seo page's
// page.data. Each node exposes a lean read-only view (title/slug/path/locale) + its `data`, PLUS its
// child pages keyed by their slug, so the walk descends the page tree. Same-locale (a German page reads
// the German subtree via localized slugs) and built REFERENCED-ONLY — a page that never names `pages`
// ships no `pages` payload (the gate below), and only the nodes actually referenced are serialized.
//
// COLLISIONS: a node carries both child pages (by slug) AND its own fields, so a child whose slug is one
// of the 5 RESERVED field names (`data`/`title`/`path`/`slug`/`locale`) would be ambiguous. We resolve it
// deterministically — the reserved fields are assigned LAST, so they always WIN: `pages.x.data` is always
// the data object, `pages.x.title` always the title string. Such a child is simply not reachable via the
// bare-slug walk (slugs are lowercase [a-z0-9-], so only those 5 words can ever collide — very rare).

/** A built page node: the lean view + `data`, plus child nodes keyed by slug. Reserved keys win. */
type PageNode = Record<string, unknown>;

/** Node field names that take precedence over a same-named child slug (the collision rule). */
const RESERVED_FIELDS = new Set(['data', 'title', 'path', 'slug', 'locale']);

/** Upper bound on total nodes built for one page's `pages` context (payload / DoS guard). */
export const MAX_PAGES_NODES = 500;
/** Upper bound on slug-walk depth (the page tree is shallow; this just caps a pathological source). */
const MAX_PAGES_DEPTH = 24;

// `pages` used as a BINDING — `pages.<slug>` / `pages.[…]` (a real access) or a bare `{{pages}}` /
// `(pages)`. NOT preceded by an identifier/`.`/`-` (so `mypages` / `x.pages` / `a-pages` don't match),
// and the access form is required so prose like "our pages are fast" / "browse the pages." does NOT
// trip it (that `pages` is followed by whitespace / a bare `.`, not `.<letter>`). The cheap gate that
// keeps the page-data-carrying `pages` object off the render-worker IPC unless the source uses it.
const PAGES_REF_RE = /(?<![\w.-])pages(?:\.\[?[A-Za-z_]|}|\))/;

/** Whether a template source references the `pages` binding — build the tree only when it does. */
export function referencesPages(source: string | null | undefined): boolean {
  return typeof source === 'string' && PAGES_REF_RE.test(source);
}

// Every `pages.<seg>(.<seg>)*` chain in the source, each as its raw segment list (a segment is a dotted
// identifier OR a `[bracketed]` key, so a localized slug like `web-design` works as `pages.[web-design]`).
// Regex-only (no parser) — keeps core dependency-free, like `extractRegions`. The builder decides which
// segments are slugs vs a trailing field by walking the actual tree (so it needs no field guessing here).
const CHAIN_RE = /(?<![\w.-])pages((?:\.[A-Za-z_][\w-]*|\.\[[^\]]+\])+)/g;
const SEG_RE = /\.\[([^\]]+)\]|\.([A-Za-z_][\w-]*)/g;

/** The slug/field chains referenced off `pages` (e.g. `pages.services.seo.data.h1` → ['services','seo','data','h1']). */
export function referencedPagePaths(source: string): string[][] {
  const chains: string[][] = [];
  for (const m of source.matchAll(CHAIN_RE)) {
    const segs: string[] = [];
    for (const s of m[1]!.matchAll(SEG_RE)) segs.push((s[1] ?? s[2])!);
    if (segs.length > 0) chains.push(segs);
  }
  return chains;
}

/**
 * Build the `pages` render context for `currentPage` — its locale HOME node + only the descendant nodes
 * named by `source`'s `pages.*` references, as a minimal nested object. `undefined` when the source
 * doesn't reference `pages` or the locale has no home (→ renders empty). Published/draft visibility
 * follows WHICH `pages` list the caller passes (preview + publish both pass the published subset).
 */
export function pagesContext(
  pages: readonly Page[],
  currentPage: Page,
  defaultLocale: string,
  source: string | null | undefined,
): PageNode | undefined {
  if (!referencesPages(source)) return undefined;
  const locale = localeOf(currentPage, defaultLocale);
  const home = localeHomeFor(pages, locale, defaultLocale);
  if (!home) return undefined;

  const byId = pagesById(pages);
  // Direct children of a page, in THIS locale, excluding collection (`[param]`) pages (not real children).
  const childrenOf = (parentId: string): Page[] =>
    pages.filter((p) => p.parent === parentId && !p.collection && localeOf(p, defaultLocale) === locale);

  const budget = { n: 0 };
  const build = (node: Page, chains: string[][], depth: number): PageNode => {
    const out: PageNode = {};
    const childChains = new Map<string, string[][]>(); // child slug → remaining chains
    let needData = false;
    if (depth < MAX_PAGES_DEPTH) {
      const kids = childrenOf(node.id);
      for (const chain of chains) {
        if (chain.length === 0) continue;
        const seg = chain[0]!;
        // A RESERVED field name is a field access on THIS node — checked BEFORE child matching so a
        // child whose slug is e.g. "data" can never be descended into (reserved wins, deterministically).
        if (RESERVED_FIELDS.has(seg)) {
          if (seg === 'data') needData = true; // gate the (only large) field; title/slug/path/locale are always present
          continue;
        }
        const kid = kids.find((k) => k.path === seg);
        if (kid) {
          const list = childChains.get(seg) ?? [];
          list.push(chain.slice(1));
          childChains.set(seg, list);
        }
        // an unknown slug → stop (the path renders empty)
      }
      for (const [slug, list] of childChains) {
        if (budget.n >= MAX_PAGES_NODES) break;
        budget.n++;
        const kid = kids.find((k) => k.path === slug)!;
        out[slug] = build(kid, list, depth + 1); // slug = a page's own `path` (identifierize'd), not user input; out is a fresh object
      }
    }
    // Reserved fields assigned LAST → they WIN over a same-named child slug (see COLLISIONS note above).
    // `data` is gated to referenced uses (it's the only field large enough to matter for payload); the
    // lean fields are tiny and always present. `{}` keeps `pages.x.data` deterministic when not referenced.
    out.title = node.title;
    out.slug = node.path;
    out.path = pagePath(node, byId);
    out.locale = locale;
    out.data = needData ? ((node.data as JsonValue | undefined) ?? {}) : {};
    return out;
  };

  return build(home, referencedPagePaths(source as string), 0);
}
