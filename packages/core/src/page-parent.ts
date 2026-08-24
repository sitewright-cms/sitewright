import { isLinkPage, type Page } from '@sitewright/schema';
import { localeOf, localeHomeFor } from './i18n.js';

/**
 * THE PAGE-TREE INVARIANT: every page except the site's root home hangs off a home page.
 *
 * A page with no `parent` renders as a second root — it sits flush in the pages list, forms its own
 * drag group, and can never appear in a parent's nav dropdown. Nothing in the schema prevented it, so
 * three writers produced them: a bundle import, an MCP `put_page` that omitted the field, and the
 * editor's own settings modal, which DISPLAYED a parent it had not stored. The invariant is enforced
 * at the repository instead of at each call site, because those writers do not share a code path.
 *
 * WHICH home. A page in the DEFAULT locale takes the root home. A page in another language takes THAT
 * LANGUAGE'S home, so it lands inside its own subtree and its route reads `/de/leistungen` rather than
 * `/leistungen` — the shape `buildLocaleVariant` already produces for a scaffolded locale. A language
 * with no home of its own falls back to the root home (nothing else is reachable), and the locale home
 * itself nests under the root home, which is where its `/de` segment comes from.
 */

/** The site's root home: the empty-slug page in the default locale (a nav placeholder is not one). */
function rootHomeOf(pages: readonly Page[], defaultLocale: string): Page | undefined {
  return pages.find((p) => p.path === '' && !isLinkPage(p) && localeOf(p, defaultLocale) === defaultLocale);
}

/** True when `candidate` sits anywhere under `pageId` — the walk that keeps a repair from making a cycle. */
function descendsFrom(candidate: Page, pageId: string, byId: ReadonlyMap<string, Page>): boolean {
  const seen = new Set<string>();
  let cur: Page | undefined = candidate;
  while (cur && !seen.has(cur.id)) {
    if (cur.id === pageId) return true;
    seen.add(cur.id);
    cur = cur.parent ? byId.get(cur.parent) : undefined;
  }
  return false;
}

/**
 * The parent `page` should hang off when it has none: its own language's home, else the root home.
 * `undefined` when there is nothing to hang it off — `page` IS the root home, the project has no home
 * yet (the very first write into an empty project), or the only candidate descends from `page` and
 * would close a cycle.
 */
export function defaultParentFor(page: Page, pages: readonly Page[], defaultLocale: string): string | undefined {
  const root = rootHomeOf(pages, defaultLocale);
  if (!root || root.id === page.id) return undefined;

  const locale = localeOf(page, defaultLocale);
  // A locale home is its language's root; it nests under the SITE root, not under itself.
  const localeHome = locale === defaultLocale ? undefined : localeHomeFor(pages, locale, defaultLocale);
  const target = localeHome && localeHome.id !== page.id ? localeHome : root;

  const byId = new Map(pages.map((p) => [p.id, p]));
  if (descendsFrom(target, page.id, byId)) return undefined;
  return target.id;
}

export interface ResolveParentOptions {
  /**
   * Also replace a `parent` that cannot be honoured because the page it names isn't in `pages`, or
   * because following it leads back to this page (a cycle). Off by default: a SINGLE write legitimately
   * arrives before its parent does (a caller creating a subtree child-first), and silently redirecting
   * that page to home would override an intent the next write makes good — and a cycle cannot be judged
   * from one page anyway. On for a whole-project pass (an import bundle, the backfill), where every page
   * IS present, so an unresolvable or circular id is genuinely broken and already renders as a root.
   */
  repairDangling?: boolean;
}

/**
 * Whether `page.parent` fails the invariant and must be recomputed.
 *
 * A cycle is the case worth spelling out. `parent` naming a page that EXISTS is not enough: a page whose
 * parent is itself, or two pages parented to each other, both pass an existence check while forming a
 * closed loop that no home is at the top of. They are second roots exactly like a parentless page, but
 * an existence test reports them as fine — so the whole-project repair pass, whose entire job is to
 * leave nothing rootless, would walk straight past them. A self-parent is rejected even on a single
 * write: unlike a forward reference it can never be made good by a later write.
 */
function parentIsBroken(page: Page, pages: readonly Page[], repairDangling: boolean): boolean {
  if (page.parent === undefined) return true;
  if (page.parent === page.id) return true;
  if (!repairDangling) return false;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const parent = byId.get(page.parent);
  if (!parent) return true;
  return descendsFrom(parent, page.id, byId);
}

/**
 * `page` with the invariant applied — unchanged (by identity) when it already satisfies it, so a
 * caller can cheaply tell whether anything moved.
 */
export function withResolvedParent(
  page: Page,
  pages: readonly Page[],
  defaultLocale: string,
  opts: ResolveParentOptions = {},
): Page {
  if (!parentIsBroken(page, pages, opts.repairDangling === true)) return page;
  const parent = defaultParentFor(page, pages, defaultLocale);
  if (parent === undefined || parent === page.parent) return page;
  return { ...page, parent };
}
