import { isLinkPage, type Page } from '@sitewright/schema';
import { hasOwnCode, localeHomeFor, localeOf } from './i18n.js';
import { withResolvedParent } from './page-parent.js';
import { pagePath, pagesById } from './routes.js';

/**
 * What removing pages does to the pages that stay.
 *
 * A page is not a leaf: other rows point AT it. Deleting one used to remove just its row, so:
 *  - its CHILDREN kept `parent` set to a page that was gone. They rendered as extra roots and the
 *    integrity check reported them (`missing_page_parent`);
 *  - its language VARIANTS that inherit its code were left with an owner that no longer exists, so they
 *    rendered empty. Only the editor's delete-group route took them along; an API or MCP delete did not.
 *
 * This works out the whole consequence before anything is written, so every delete path applies the
 * same rule and can refuse up front instead of leaving a broken tree behind.
 */
export interface PageRemovalPlan {
  /** Every page that goes: the requested ones plus, with `cascadeVariants`, the variants that follow them. */
  removed: Page[];
  /** The subset of `removed` that was not asked for: inherit-mode variants of a removed main-language page. */
  cascaded: Page[];
  /** Pages that stay but move up: their parent is removed, so they hang off the nearest ancestor that stays. */
  reparented: Page[];
  /** Variants with their own code that stay, detached from the removed main-language page's group. */
  detached: Page[];
  /**
   * Addresses the removal would give to more than one page — publish refuses that. Only clashes the
   * removal CAUSES are listed (a page that moved is involved), never one that was already there.
   */
  clashes: Array<{ route: string; pageIds: string[] }>;
}

export interface PageRemovalOptions {
  /**
   * Also remove the inherit-mode language variants of each removed main-language page, and detach the
   * ones with their own code — what the editor's "delete across languages" does. Off for a caller that
   * has already decided the exact set (removing a whole language, the delete-group route itself).
   */
  cascadeVariants?: boolean;
}

/**
 * Plan the removal of `ids` from `pages`. Pure: nothing is written, and unknown ids are ignored.
 *
 * A child moves to the NEAREST ANCESTOR THAT STAYS, which is what makes it "move up one level": a page
 * under a deleted `/services/` lands where `/services/` was, under its parent. Only when the whole chain
 * above it goes does it fall back to the rule a new page follows (its language home, else the root home).
 */
export function planPageRemoval(
  pages: readonly Page[],
  ids: readonly string[],
  defaultLocale: string,
  opts: PageRemovalOptions = {},
): PageRemovalPlan {
  const byId = pagesById(pages);
  const requested = [...new Set(ids)].map((id) => byId.get(id)).filter((p): p is Page => p !== undefined);
  const removedIds = new Set(requested.map((p) => p.id));

  const cascaded: Page[] = [];
  const detachedById = new Map<string, Page>();
  if (opts.cascadeVariants) {
    for (const owner of requested) {
      if (localeOf(owner, defaultLocale) !== defaultLocale) continue; // only a main-language page owns code
      // The group key the way the locale tools resolve it: a main page that never got the field
      // explicitly still leads the group named after its id.
      const group = owner.translationGroup ?? owner.id;
      for (const v of pages) {
        if (v.id === owner.id || v.translationGroup !== group || removedIds.has(v.id)) continue;
        if (hasOwnCode(v)) {
          const copy: Page = { ...v };
          delete copy.translationGroup;
          detachedById.set(v.id, copy);
        } else {
          removedIds.add(v.id);
          cascaded.push(v);
        }
      }
    }
  }

  // The tree after removal, with detached copies in place of their originals.
  const survivors = pages.filter((p) => !removedIds.has(p.id)).map((p) => detachedById.get(p.id) ?? p);
  const nextById = pagesById(survivors);

  const reparentedById = new Map<string, Page>();
  for (const page of survivors) {
    if (!page.parent || !removedIds.has(page.parent)) continue;
    let up: Page | undefined = byId.get(page.parent);
    while (up && removedIds.has(up.id)) up = up.parent ? byId.get(up.parent) : undefined;
    let moved: Page;
    if (up) {
      moved = { ...page, parent: up.id };
    } else {
      const orphan: Page = { ...page };
      delete orphan.parent;
      moved = withResolvedParent(orphan, survivors, defaultLocale);
    }
    reparentedById.set(page.id, moved);
    nextById.set(page.id, moved);
  }
  const after = [...nextById.values()];

  // Routes, the way publish computes them (link placeholders have none). A clash counts only when a page
  // whose address CHANGED is part of it, so an unrelated duplicate already in the project is not blamed
  // on this removal.
  const routed = (list: readonly Page[]) => list.filter((p) => !isLinkPage(p));
  const before = new Map(routed(pages).map((p) => [p.id, pagePath(p, byId)]));
  const routeAfter = new Map(routed(after).map((p) => [p.id, pagePath(p, nextById)]));
  const byRoute = new Map<string, string[]>();
  for (const [id, route] of routeAfter) byRoute.set(route, [...(byRoute.get(route) ?? []), id]);
  const clashes = [...byRoute.entries()]
    .filter(([, sharing]) => sharing.length > 1 && sharing.some((id) => before.get(id) !== routeAfter.get(id)))
    .map(([route, pageIds]) => ({ route, pageIds }));

  return {
    removed: [...requested, ...cascaded],
    cascaded,
    reparented: [...reparentedById.values()],
    detached: [...detachedById.values()].map((p) => reparentedById.get(p.id) ?? p),
    clashes,
  };
}

/**
 * Why `page` may not be removed on its own, or null when it may. The root home is the tree's root, and a
 * language's home is the root of that language's subtree (removed with the language, in Settings →
 * Localization). With pages under either, there is no ancestor to move them to: the root home's children
 * would become extra roots, and a language home's would land at the top level, outside their language.
 * Without children there is nothing to strand, so a lone empty page stays deletable.
 */
export function pageRemovalRefusal(page: Page, pages: readonly Page[], defaultLocale: string): string | null {
  if (isLinkPage(page)) return null;
  const children = pages.filter((p) => p.parent === page.id).length;
  if (children === 0) return null;
  const under = `${children} page${children === 1 ? '' : 's'} hang${children === 1 ? 's' : ''} under it`;
  const locale = localeOf(page, defaultLocale);
  if (page.path === '' && locale === defaultLocale) return `the home page cannot be deleted while ${under}`;
  if (locale !== defaultLocale && localeHomeFor(pages, locale, defaultLocale)?.id === page.id) {
    return `the "${locale}" home page is removed together with its language (${under}) — remove the language in Settings → Localization`;
  }
  return null;
}
