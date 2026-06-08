import type { NavSlot, Page } from '@sitewright/schema';
import { pagePath, pagesById } from './routes.js';

export type { NavSlot };

export interface NavItem {
  label: string;
  /** Target page route (root-relative, e.g. '/about'), computed from the page tree; rebased per page at render. */
  path: string;
  /** Child-page items, present when the page's `nav.dropdown` is on (render as a dropdown). */
  children?: NavItem[];
}

/**
 * Sibling order then title — explicit 'en' locale for deterministic ordering across
 * environments. Prefers the page-tree `order` (set by drag-reordering the pages list) so the
 * menu follows the list, falling back to the legacy `nav.order` when it is absent. Shared with
 * `childrenOf` so `{{#each page.children}}` and the auto-nav order siblings identically.
 */
export function byNavOrder(a: Page, b: Page): number {
  const av = a.order ?? a.nav?.order ?? 0;
  const bv = b.order ?? b.nav?.order ?? 0;
  return av - bv || a.title.localeCompare(b.title, 'en');
}

function toItem(page: Page, byId: ReadonlyMap<string, Page>): NavItem {
  return { label: page.nav?.title || page.title, path: pagePath(page, byId) };
}

/**
 * Builds the ordered navigation items for a slot from the page tree — concrete
 * (non-collection) pages whose `nav.slots` includes the slot, sorted by
 * `nav.order` then title. The label falls back from `nav.title` to the page title.
 *
 * Sub-pages: when a parent page's `nav.dropdown` is ON, its child pages (those
 * whose `parent` is the parent's id) NEST under the parent's item as `children`
 * — they need no own `nav.slots`, and they never ALSO appear flat in the slot.
 * With the toggle off, children behave like any page: flat, own slots required.
 *
 * Nesting is deliberately ONE level deep (dropdowns of dropdowns don't exist in
 * the rendered nav): a grandchild of a dropdown chain is simply absent. Parent
 * CYCLES (a→b→a) cannot loop here — the passes are flat filters — such pages
 * just drop out of the nav until the cycle is fixed.
 */
export function buildNav(pages: readonly Page[], slot: NavSlot): NavItem[] {
  // Index for computing each item's full route from the page tree (`pagePath`). When a
  // per-locale subset is passed (publish/preview), ancestors outside the subset are absent
  // from `byId` → the chain ends there, which is the intended behavior.
  const byId = pagesById(pages);
  // Pages whose children fold into a dropdown under them.
  const dropdownParents = new Set(pages.filter((p) => p.nav?.dropdown === true).map((p) => p.id));
  return pages
    .filter(
      (page) =>
        !page.collection &&
        (page.nav?.slots.includes(slot) ?? false) &&
        // Nested under a dropdown parent → rendered as that parent's child, never flat.
        !(page.parent && dropdownParents.has(page.parent)),
    )
    .sort(byNavOrder)
    .map((page) => {
      const item = toItem(page, byId);
      if (page.nav?.dropdown !== true) return item;
      const children = pages
        .filter((child) => child.parent === page.id && !child.collection)
        .sort(byNavOrder)
        .map((child) => toItem(child, byId));
      return children.length > 0 ? { ...item, children } : item;
    });
}
