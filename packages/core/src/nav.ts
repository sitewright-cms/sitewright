import type { NavSlot, Page } from '@sitewright/schema';

export type { NavSlot };

export interface NavItem {
  label: string;
  /** Target page path (root-relative, e.g. '/about'); rebased per page at render. */
  path: string;
  /** Child-page items, present when the page's `nav.dropdown` is on (render as a dropdown). */
  children?: NavItem[];
}

/** `nav.order` then title — explicit 'en' locale for deterministic ordering across environments. */
function byNavOrder(a: Page, b: Page): number {
  return (a.nav?.order ?? 0) - (b.nav?.order ?? 0) || a.title.localeCompare(b.title, 'en');
}

function toItem(page: Page): NavItem {
  return { label: page.nav?.title || page.title, path: page.path };
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
      const item = toItem(page);
      if (page.nav?.dropdown !== true) return item;
      const children = pages
        .filter((child) => child.parent === page.id && !child.collection)
        .sort(byNavOrder)
        .map(toItem);
      return children.length > 0 ? { ...item, children } : item;
    });
}
