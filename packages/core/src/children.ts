import type { JsonValue, Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';
import { byNavOrder } from './nav.js';
import { localeOf } from './i18n.js';

/**
 * One child page, FLATTENED for template use — `{{#each page.children}}…{{/each}}`. The fields are a
 * projection of the child Page's record (its DB shape flattened): `seo.description → description`,
 * `seo.ogImage → image`, etc. `path` is the child's FULL computed route (use it in `href="{{sw-url path}}"`).
 * `data` is the child's own `page.data` object, so an overview reads `{{#each page.children}}{{data.x}}`.
 */
export interface PageChild {
  id: string;
  title: string;
  /** The child's own slug SEGMENT (its `path` field), e.g. `my-article`. */
  slug: string;
  /** The full root-relative route (computed from the parent chain) — wrap in `{{sw-url path}}` for a link. */
  path: string;
  /** SEO description (`seo.description`), flattened. */
  description: string;
  /** Open Graph image (`seo.ogImage`), flattened — wrap in `{{sw-url image}}` for a portable src. */
  image: string;
  /** SEO title (`seo.title`), flattened. */
  seoTitle: string;
  /** Whether the child is `noindex` (`seo.noindex`). */
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
 * Upper bound on how many children one `{{#each page.children}}` yields. Each child carries its own
 * `data`, so an uncapped count would let a huge page tree spike the render payload (preview IPC) and
 * the published HTML. A blog past this many posts wants pagination (a follow-up). Matches the 500-cap
 * used for dataset entries / redirects / content regions.
 */
export const MAX_PAGE_CHILDREN = 500;

/**
 * A lean read-only view of a page's PARENT, for the top-level `parentPage` binding —
 * `{{parentPage.path}}`, `{{parentPage.data.x}}`. `undefined` when the page is a tree root / home or
 * its `parent` id doesn't resolve (so `{{parentPage.*}}` renders empty). Mirrors the child projection
 * in {@link childrenOf}: `slug` is the parent's own segment, `path` its full computed route.
 */
export interface ParentPageView {
  title: string;
  /** The parent's own slug SEGMENT (its `path` field). */
  slug: string;
  /** The parent's FULL computed route (use in `href="{{sw-url parentPage.path}}"`). */
  path: string;
  locale: string;
  /** The parent's own `page.data` object (empty object when unset). */
  data: JsonValue;
}

/**
 * Flattens `page`'s direct PARENT to a {@link ParentPageView}, or `undefined` when there is none. ONE
 * level only — the parent's own parent is NOT nested (no `parentPage.parentPage`), which bounds the
 * render payload and keeps the binding simple. Same projection rules as {@link childrenOf}.
 */
export function parentPageView(pages: readonly Page[], page: Page, defaultLocale: string): ParentPageView | undefined {
  if (!page.parent) return undefined;
  const byId = pagesById(pages);
  const parent = byId.get(page.parent);
  if (!parent) return undefined;
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
export function childrenOf(pages: readonly Page[], page: Page, defaultLocale: string): PageChild[] {
  const byId = pagesById(pages);
  const pageLocale = localeOf(page, defaultLocale);
  return pages
    .filter((c) => c.parent === page.id && !c.collection && localeOf(c, defaultLocale) === pageLocale)
    .sort(byNavOrder)
    .slice(0, MAX_PAGE_CHILDREN)
    .map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.path,
      path: pagePath(c, byId),
      description: c.seo?.description ?? '',
      image: c.seo?.ogImage ?? '',
      seoTitle: c.seo?.title ?? '',
      noindex: c.seo?.noindex ?? false,
      navTitle: c.nav?.title || c.title,
      status: c.status ?? 'published',
      locale: localeOf(c, defaultLocale),
      order: c.order ?? c.nav?.order ?? 0,
      data: (c.data as JsonValue | undefined) ?? {},
    }));
}
