import { isLinkPage, type JsonValue, type Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';
import { byNavOrder } from './nav.js';
import { localeOf } from './i18n.js';

/**
 * One child page, FLATTENED for template use — `{{#each page.children}}…{{/each}}`. The fields are a
 * projection of the child Page's record: `title`, `description`, `image` (its OG/share image), `noindex`,
 * etc. `path` is the child's FULL computed route (use it in `href="{{sw-url path}}"`).
 * `data` is the child's own `page.data` object, so an overview reads `{{#each page.children}}{{data.x}}`.
 */
export interface PageChild {
  id: string;
  title: string;
  /** The child's own slug SEGMENT (its `path` field), e.g. `my-article`. */
  slug: string;
  /** The full root-relative route (computed from the parent chain) — wrap in `{{sw-url path}}` for a link. */
  path: string;
  /** The child's meta description (`page.description`). */
  description: string;
  /** The child's OG/share image (`page.image`) — wrap in `{{sw-url image}}` for a portable src. */
  image: string;
  /** Whether the child is `noindex` (`page.noindex`). */
  noindex: boolean;
  /** The child's nav label (`nav.title`) when set, else its title. */
  navTitle: string;
  /** `published` (the default) or `draft`. */
  status: 'draft' | 'published';
  /** The child's effective locale. */
  locale: string;
  /** The child's sibling sort order (the value used for ordering; 0 when unset). */
  order: number;
  /** The child's own `page.data` object (empty object when unset). */
  data: JsonValue;
}

/**
 * Backstop on how many children one `{{#each page.children}}` yields.
 *
 * ★ This is NOT the bound that decides in practice — {@link MAX_PAGE_CHILDREN_BYTES} is. It was 500,
 * chosen to match the entry/redirect/region caps, and that number turned out to be a ceiling on a whole
 * FEATURE: a news section with 831 posts as child pages can be paginated with {{sw-paginate}}, but only
 * over children the listing actually contains, so every archive page past the 50th rendered empty.
 * 2000 covers a real long-lived site's archive; past that the answer is a dataset, not a bigger array.
 */
export const MAX_PAGE_CHILDREN = 2000;

/**
 * Budget for the SERIALIZED size of one `page.children` listing — the bound that actually protects the
 * render payload (preview IPC, the publish worker's job) and the reason the count cap existed at all.
 *
 * A count is a poor proxy for weight: each child carries its own `page.data`, which ranges from nothing
 * to tens of KB. 500 lean children are ~180 KB and were truncated for no reason; 500 fat ones are ~25 MB
 * and were waved through. Measuring the thing we actually care about fixes both directions at once, and
 * it bounds its own cost — the walk stops measuring as soon as it stops listing.
 */
export const MAX_PAGE_CHILDREN_BYTES = 2 * 1024 * 1024;

/** Fixed JSON overhead per child — the key names, braces, quotes and commas of a {@link PageChild}. */
const PAGE_CHILD_JSON_OVERHEAD = 160;

/**
 * UTF-8 byte length.
 *
 * ★ NOT `String.length`, which counts UTF-16 code units: that undercounts CJK text by 3x and astral
 * emoji by 2x. A budget whose whole job is to bound the render PAYLOAD has to measure the bytes that
 * actually cross it, or a Japanese or Chinese site quietly ships a listing several times over the
 * ceiling while a Latin one is held to it. (`TextEncoder` rather than `Buffer` — this package is
 * bundled into the browser editor and deliberately imports nothing from `node:`.)
 */
const UTF8 = new TextEncoder();
function utf8Bytes(value: string): number {
  return UTF8.encode(value).length;
}

/**
 * Roughly how many bytes a child adds to the render context. The scalar fields are schema-bounded, so
 * only `data` — the unbounded part — is measured exactly.
 */
function approxChildBytes(child: PageChild): number {
  const scalars =
    utf8Bytes(child.id) +
    utf8Bytes(child.title) +
    utf8Bytes(child.slug) +
    utf8Bytes(child.path) +
    utf8Bytes(child.description) +
    utf8Bytes(child.image) +
    utf8Bytes(child.navTitle) +
    utf8Bytes(child.locale);
  // `data` is JSON-sourced, so it cannot be circular; the guard is for a value that somehow isn't
  // serializable, which must degrade to "cheap" rather than throw mid-listing.
  let dataBytes = 0;
  try {
    const json = JSON.stringify(child.data);
    dataBytes = json === undefined ? 0 : utf8Bytes(json);
  } catch {
    dataBytes = 0;
  }
  return PAGE_CHILD_JSON_OVERHEAD + scalars + dataBytes;
}

/** {@link childrenOf}'s result plus the count it would have returned uncapped — see {@link childrenView}. */
export interface ChildrenView {
  /** The listed children, bounded by {@link MAX_PAGE_CHILDREN_BYTES} / {@link MAX_PAGE_CHILDREN}. */
  children: PageChild[];
  /** How many children the parent really has (same filter, no bound) — bound as `{{page.childrenTotal}}`. */
  total: number;
  /** `total > children.length` — a bound dropped some. */
  truncated: boolean;
  /** Roughly what the listed children weigh, so a caller building SEVERAL listings can budget across them. */
  bytes: number;
}

/** Per-call overrides for {@link childrenView}. */
export interface ChildrenLimits {
  /**
   * Byte budget for THIS listing, when the caller has its own aggregate to spend (see `pagesContext`,
   * which may build hundreds of listings for one render). Defaults to {@link MAX_PAGE_CHILDREN_BYTES};
   * values above it are ignored, so a caller can only ever tighten the bound, never widen it.
   */
  maxBytes?: number;
  /**
   * Whether a single child bigger than the whole budget is still listed. Default `true` — one oversized
   * post must not empty an archive. A caller spending a SHARED budget passes `false` once it is gone:
   * there, "list one anyway" per node is how N nodes each overshoot.
   */
  atLeastOne?: boolean;
}

/**
 * A lean read-only view of a page's PARENT, exposed to templates as the `page.parent` binding —
 * `{{page.parent.path}}`, `{{page.parent.data.x}}`. `undefined` when the page is a tree root / home or
 * its `parent` id doesn't resolve (so `{{page.parent.*}}` renders empty). Mirrors the child projection
 * in {@link childrenOf}: `slug` is the parent's own segment, `path` its full computed route.
 */
export interface ParentPageView {
  title: string;
  /** The parent's own slug SEGMENT (its `path` field). */
  slug: string;
  /** The parent's FULL computed route (use in `href="{{sw-url page.parent.path}}"`). */
  path: string;
  locale: string;
  /** The parent's own `page.data` object (empty object when unset). */
  data: JsonValue;
}

/**
 * Flattens `page`'s direct PARENT to a {@link ParentPageView}, or `undefined` when there is none. ONE
 * level only — the parent's own parent is NOT nested (no `page.parent.parent`), which bounds the
 * render payload and keeps the binding simple. Same projection rules as {@link childrenOf}.
 */
export function parentPageView(pages: readonly Page[], page: Page, defaultLocale: string): ParentPageView | undefined {
  if (!page.parent) return undefined;
  const byId = pagesById(pages);
  const parent = byId.get(page.parent);
  // A nav PLACEHOLDER (kind:'link', path:'') is grouping/menu chrome, not a real page — it has no
  // route or content, so it's not a meaningful `page.parent` (its view would be a degenerate empty
  // slug + rich nav label). Mirrors childrenOf: placeholders are absent from BOTH directions of the
  // page↔page binding model. A page nested under a placeholder simply has no parent-page binding.
  if (!parent || isLinkPage(parent)) return undefined;
  return {
    title: parent.title,
    slug: parent.path,
    path: pagePath(parent, byId),
    locale: localeOf(parent, defaultLocale),
    data: (parent.data as JsonValue | undefined) ?? {},
  };
}

/**
 * The direct child pages of `page` (those whose `parent` is its id), FLATTENED to {@link PageChild}
 * for `{{#each page.children}}`. Same-locale only (an overview lists articles in its own language),
 * non-collection (collection `[param]` pages aren't real tree children), ordered by the shared
 * sibling order (page-tree `order` → legacy `nav.order` → title), and capped at {@link MAX_PAGE_CHILDREN}.
 * Draft visibility follows WHICH list the caller passes: both the preview and publish call sites pass
 * the already-published subset (drafts excluded — the preview mirrors publish, like nav/translations).
 */
export function childrenOf(pages: readonly Page[], page: Page, defaultLocale: string, limits?: ChildrenLimits): PageChild[] {
  return childrenView(pages, page, defaultLocale, limits).children;
}

/**
 * `page.children` PLUS the true child count — so a caller can tell that {@link MAX_PAGE_CHILDREN}
 * dropped some, and say so.
 *
 * ★ The cap used to be a bare `.slice()`: a parent with 831 children listed 500 and reported nothing,
 * anywhere. That is the silent-wrong-answer class — the author sees a plausible page and has no way to
 * learn a third of it is missing. `total` counts exactly the children that WOULD be listed (same
 * filter), so the number is honest rather than a raw sibling count that would over-report.
 */
export function childrenView(pages: readonly Page[], page: Page, defaultLocale: string, limits?: ChildrenLimits): ChildrenView {
  const budget = Math.max(0, Math.min(limits?.maxBytes ?? MAX_PAGE_CHILDREN_BYTES, MAX_PAGE_CHILDREN_BYTES));
  const atLeastOne = limits?.atLeastOne ?? true;
  const byId = pagesById(pages);
  const pageLocale = localeOf(page, defaultLocale);
  const listable = pages
    // `page.children` is a CONTENT listing (title/description/image/data) — exclude nav PLACEHOLDERS
    // (kind:'link', path:''). A placeholder is grouping/menu chrome, not a content child; leaving it in
    // leaked a degenerate entry (empty slug + rich nav label). Nav DROPDOWNS gather children separately
    // (buildNav), so they're unaffected. Collections ([param] pages) are excluded too — not real children.
    .filter((c) => c.parent === page.id && !c.collection && !isLinkPage(c) && localeOf(c, defaultLocale) === pageLocale)
    .sort(byNavOrder);
  // Walk in order, stopping at whichever bound trips first — the byte budget in practice, the count as
  // a backstop. Projecting lazily means an over-budget listing never builds the children it won't use.
  const children: PageChild[] = [];
  let bytes = 0;
  for (const c of listable) {
    if (children.length >= MAX_PAGE_CHILDREN) break;
    const child: PageChild = {
      id: c.id,
      title: c.title,
      slug: c.path,
      path: pagePath(c, byId),
      description: c.description ?? '',
      image: c.image ?? '',
      noindex: c.noindex ?? false,
      navTitle: c.nav?.title || c.title,
      status: c.status ?? 'published',
      locale: localeOf(c, defaultLocale),
      order: c.order ?? c.nav?.order ?? 0,
      data: (c.data as JsonValue | undefined) ?? {},
    };
    bytes += approxChildBytes(child);
    // ★ By default ALWAYS list at least one. A single post fatter than the whole budget would otherwise
    // empty the archive, and an empty archive reads as "no posts yet" — the silent-wrong-answer this
    // file exists to avoid. One oversized child is a bounded overshoot; zero children is a lie.
    // A caller spending a SHARED budget across many listings turns that off once it runs out, because
    // there "one anyway" per listing is exactly how the aggregate escapes its bound.
    if (bytes > budget && (children.length > 0 || !atLeastOne)) {
      bytes -= approxChildBytes(child); // not listed → not counted
      break;
    }
    children.push(child);
  }
  return { children, total: listable.length, truncated: listable.length > children.length, bytes };
}
