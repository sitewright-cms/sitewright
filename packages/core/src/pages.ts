import type { JsonValue, Page } from '@sitewright/schema';
import { pagesById, pagePath } from './routes.js';
import { localeOf, localeHomeFor } from './i18n.js';
import { childrenView } from './children.js';

// The `pages` namespace: cross-page DIRECT access by slug path, rooted at the CURRENT page's locale
// HOME and walked by slug — `{{ pages.services.seo._attributes.data.header_title }}` reads the
// /services/seo page's page.data. Same-locale (a German page reads the German subtree via localized
// slugs) and built REFERENCED-ONLY — a page that never names `pages` ships no `pages` payload (the gate
// below), and only the nodes actually referenced are serialized.
//
// NO COLLISIONS, ANY SLUG. A node mixes two things that would otherwise share one key space: its CHILD
// pages (addressed by their slug — `pages.services`, `pages.[web-design]`) and its OWN fields (title,
// data, image, …). They are kept in SEPARATE namespaces so a page may use ANY slug (no reserved words,
// no SEO restriction): a node's children sit at its top level by slug, and everything the node OWNS lives
// under the single `_attributes` key. No traversable node can EVER have path `_attributes`: PageSlugSchema
// (`^$|^[a-z0-9]+(?:-[a-z0-9]+)*$`) admits no underscore at all, so a child slug and `_attributes` can never
// clash. (Bracketed `[param]` slugs used to be the one exception; collection pages were removed and the
// schema no longer accepts them.) Read a page's own fields through
// `_attributes` (`pages.about._attributes.image`, `pages._attributes.data` for home); descend to a child
// with a bare slug (`pages.about`, `pages.services.[web-design]`). Thus a page literally slugged `data`
// or `image` is fully reachable: `pages.data._attributes.title` (the page) vs `pages._attributes.data`
// (home's data) are unambiguous.
//
// `_attributes` exposes the lean always-present fields (title/slug/path/locale/image/description/template)
// plus the heavy fields gated to referenced uses (`data`, `children` — same array view as `page.children`,
// `code` — the page's own source). `{{#each pages.services._attributes.children}}` lists a subtree from
// ANOTHER page (page.children only sees the CURRENT page's children).

/** The single key under which a node exposes its OWN fields (kept apart from its child slugs). */
export const PAGE_ATTRS_KEY = '_attributes';

/** A built page node: child nodes keyed by slug + one `_attributes` object of the node's own fields. */
type PageNode = Record<string, unknown>;

/** Upper bound on total nodes built for one page's `pages` context (payload / DoS guard). */
export const MAX_PAGES_NODES = 500;

/**
 * Aggregate byte budget for the CHILD LISTINGS across the whole `pages` context.
 *
 * ★ A node cap is not a payload cap. Every node may carry a `children` listing, each independently
 * bounded, so N nodes multiply: 50 referenced nodes measured at 68 MB, and at 500 the callers' own
 * `JSON.stringify(pagesForRender).length > 4MB` payload check threw `RangeError: Invalid string length`
 * — the guard could not even MEASURE what it was there to reject, because the structure was already
 * built and handed to it. Budgeting DURING the walk is what makes that guard reachable.
 *
 * Deliberately set ABOVE the callers' 4 MiB payload ceiling: anything that would have breached it still
 * reaches it and fails LOUDLY with a real error, rather than being silently trimmed to fit here.
 */
export const MAX_PAGES_CONTEXT_BYTES = 6 * 1024 * 1024;
/** Upper bound on slug-walk depth (the page tree is shallow; this just caps a pathological source). */
const MAX_PAGES_DEPTH = 24;

// `pages` used as a BINDING — `pages.<slug>` / `pages.[…]` (a real access) or a bare `{{pages}}` /
// `(pages)`. NOT preceded by an identifier/`.`/`-` (so `mypages` / `x.pages` / `a-pages` don't match),
// and the access form is required so prose like "our pages are fast" / "browse the pages." does NOT
// trip it (that `pages` is followed by whitespace / a bare `.`, not `.<letter>`). The cheap gate that
// keeps the page-data-carrying `pages` object off the render-worker IPC unless the source uses it.
// (`_attributes` starts with `_`, which `[A-Za-z_]` matches, so `pages._attributes.x` still fires.)
const PAGES_REF_RE = /(?<![\w.-])pages(?:\.\[?[A-Za-z_]|}|\))/;

/** Whether a template source references the `pages` binding — build the tree only when it does. */
export function referencesPages(source: string | null | undefined): boolean {
  return typeof source === 'string' && PAGES_REF_RE.test(source);
}

// Every `pages.<seg>(.<seg>)*` chain in the source, each as its raw segment list (a segment is a dotted
// identifier OR a `[bracketed]` key, so a localized slug like `web-design` works as `pages.[web-design]`).
// Regex-only (no parser) — keeps core dependency-free, like `extractRegions`. The builder decides which
// segments are slugs vs the `_attributes` field hop by walking the actual tree.
const CHAIN_RE = /(?<![\w.-])pages((?:\.[A-Za-z_][\w-]*|\.\[[^\]]+\])+)/g;
const SEG_RE = /\.\[([^\]]+)\]|\.([A-Za-z_][\w-]*)/g;

/** The slug/field chains referenced off `pages` (e.g. `pages.services._attributes.data.h1` → ['services','_attributes','data','h1']). */
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
  // Direct children of a page, in THIS locale.
  const childrenOf = (parentId: string): Page[] =>
    pages.filter((p) => p.parent === parentId && localeOf(p, defaultLocale) === locale);

  // Two budgets: how many NODES may be built, and how many BYTES their child listings may weigh in
  // total. The second is the one that bounds the payload — see MAX_PAGES_CONTEXT_BYTES.
  const budget = { n: 0, childBytes: 0 };

  /** This node's child listing, spending from the shared byte budget (empty once it is gone). */
  const listChildren = (node: Page) => {
    const remaining = MAX_PAGES_CONTEXT_BYTES - budget.childBytes;
    if (remaining <= 0) return [];
    // `atLeastOne: false` — the "never leave a listing empty" rule is right for the ONE listing a page
    // shows its reader, and wrong here: applied per node it is precisely how N nodes each overshoot.
    const view = childrenView(pages, node, defaultLocale, { maxBytes: remaining, atLeastOne: false });
    budget.childBytes += view.bytes;
    return view.children;
  };
  const build = (node: Page, chains: string[][], depth: number): PageNode => {
    const out: PageNode = {};
    const childChains = new Map<string, string[][]>(); // child slug → remaining chains
    let needData = false;
    let needChildren = false;
    let needCode = false;
    if (depth < MAX_PAGES_DEPTH) {
      // At the ROOT (depth 0), a "top-level" page is reachable by slug whether it's a CHILD of the home
      // page or a root-level SIBLING of it (both render at `/<slug>`) — the import makes top-level pages
      // root siblings, so `pages.services` must find them either way. Deeper levels: a node's own children.
      const kids =
        depth === 0
          ? pages.filter((p) => p.id !== home.id && (p.parent === home.id || !p.parent) && localeOf(p, defaultLocale) === locale)
          : childrenOf(node.id);
      for (const chain of chains) {
        if (chain.length === 0) continue;
        const seg = chain[0]!;
        // `_attributes` is a FIELD hop on THIS node (never a child slug — slugs can't start with `_`).
        // Look at the next segment to gate the heavy fields; the lean ones are always present.
        if (seg === PAGE_ATTRS_KEY) {
          const field = chain[1];
          if (field === 'data') needData = true;
          else if (field === 'children') needChildren = true;
          else if (field === 'code') needCode = true;
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
        out[slug] = build(kid, list, depth + 1); // slug = a page's own `path`, not user input; out is a fresh object
      }
    }
    // The node's OWN fields, namespaced under `_attributes` so they never collide with a child slug.
    // Lean fields (tiny) are always present; the heavy ones (`data`/`children`/`code`) are gated to
    // referenced uses — `{}`/`[]`/`''` keeps them deterministic when not referenced.
    out[PAGE_ATTRS_KEY] = {
      title: node.title,
      slug: node.path,
      path: pagePath(node, byId),
      locale,
      image: node.image ?? '',
      description: node.description ?? '',
      template: node.template ?? '',
      data: needData ? ((node.data as JsonValue | undefined) ?? {}) : {},
      children: needChildren ? listChildren(node) : [],
      code: needCode ? (node.source ?? '') : '',
    };
    return out;
  };

  return build(home, referencedPagePaths(source as string), 0);
}
