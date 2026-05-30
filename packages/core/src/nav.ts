import type { NavSlot, Page } from '@sitewright/schema';

export type { NavSlot };

export interface NavItem {
  label: string;
  /** Target page path (root-relative, e.g. '/about'); rebased per page at render. */
  path: string;
}

/**
 * Builds the ordered navigation items for a slot from the page tree — concrete
 * (non-collection) pages whose `nav.slots` includes the slot, sorted by
 * `nav.order` then title. The label falls back from `nav.title` to the page
 * title. This is contentBase's "partials auto-generate menu items", made
 * data-driven: a `Nav` block renders these for its slot.
 */
export function buildNav(pages: readonly Page[], slot: NavSlot): NavItem[] {
  return pages
    .filter((page) => !page.collection && (page.nav?.slots.includes(slot) ?? false))
    .slice()
    .sort((a, b) => {
      const ao = a.nav?.order ?? 0;
      const bo = b.nav?.order ?? 0;
      return ao - bo || a.title.localeCompare(b.title);
    })
    .map((page) => ({ label: page.nav?.title || page.title, path: page.path }));
}
