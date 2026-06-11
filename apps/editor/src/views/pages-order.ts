import type { Page } from '@sitewright/schema';

/** A page with its depth in the page tree (0 = top-level), for indented display. */
export interface TreeRow {
  page: Page;
  depth: number;
}

/** Hard cap on tree recursion (mirrors the schema's page-tree depth bound). */
const MAX_TREE_DEPTH = 100;

/** Home is the slugless ROOT page — NOT a slugless link placeholder (which is reorderable). */
const isHome = (p: Page): boolean => p.path === '' && p.kind !== 'link';

/** Canonical sibling sort value: top-level `order`, falling back to legacy `nav.order`, else 0. */
function orderValue(p: Page): number {
  return p.order ?? p.nav?.order ?? 0;
}

/**
 * Sibling order: Home (the empty-slug root) first; then default-locale pages before other
 * locales (so a locale's pages stay grouped, not interleaved); within a locale by `order`
 * then title — matching the published nav order.
 */
export function bySiblingOrder(a: Page, b: Page, defaultLocale: string): number {
  const aHome = isHome(a);
  const bHome = isHome(b);
  if (aHome !== bHome) return aHome ? -1 : 1;
  const la = a.locale ?? defaultLocale;
  const lb = b.locale ?? defaultLocale;
  const ra = la === defaultLocale ? 0 : 1;
  const rb = lb === defaultLocale ? 0 : 1;
  if (ra !== rb) return ra - rb; // default-locale pages first
  if (la !== lb) return la.localeCompare(lb, 'en'); // then grouped by locale
  return orderValue(a) - orderValue(b) || a.title.localeCompare(b.title, 'en');
}

/**
 * Flattens the pages into page-tree order — each parent immediately followed by its
 * descendants — carrying a `depth` so the list can indent sub-pages. A page whose
 * `parent` isn't in the set is treated as a root; parent cycles are broken (each
 * page appears once), recursion is depth-capped, and any unreached page is appended flat.
 */
export function orderPagesByTree(pages: readonly Page[], defaultLocale: string): TreeRow[] {
  const present = new Set(pages.map((p) => p.id));
  const childrenOf = new Map<string | undefined, Page[]>();
  for (const p of pages) {
    const key = p.parent && present.has(p.parent) ? p.parent : undefined;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), p]);
  }
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | undefined, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) return; // guard a pathologically deep chain (stack safety)
    for (const page of [...(childrenOf.get(parentId) ?? [])].sort((a, b) => bySiblingOrder(a, b, defaultLocale))) {
      if (seen.has(page.id)) continue; // cycle guard
      seen.add(page.id);
      rows.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(undefined, 0);
  for (const p of pages) if (!seen.has(p.id)) rows.push({ page: p, depth: 0 });
  return rows;
}

/**
 * Identifies a page's reorder group: pages that share the SAME resolved parent AND the same
 * locale sit in one draggable group (matching how `bySiblingOrder` groups the list). A parent
 * that isn't present resolves to the root group, mirroring `orderPagesByTree`.
 */
export function siblingKey(p: Page, present: Set<string>, defaultLocale: string): string {
  const parent = p.parent && present.has(p.parent) ? p.parent : '';
  return `${parent}::${p.locale ?? defaultLocale}`;
}

/**
 * The reorderable sibling group a page belongs to (same resolved parent + locale), in current
 * display order, EXCLUDING Home (which is pinned and never reordered). Empty if `pageId` is
 * Home or absent. Used for keyboard reordering (Arrow Up/Down moves within this group).
 */
export function orderedSiblings(pages: readonly Page[], pageId: string, defaultLocale: string): Page[] {
  const byId = new Map(pages.map((p) => [p.id, p] as const));
  const page = byId.get(pageId);
  if (!page || isHome(page)) return [];
  const present = new Set(pages.map((p) => p.id));
  const key = siblingKey(page, present, defaultLocale);
  return pages
    .filter((p) => !isHome(p) && siblingKey(p, present, defaultLocale) === key)
    .sort((a, b) => bySiblingOrder(a, b, defaultLocale));
}

/** Whether `dragId` may be dropped onto `targetId`: same group, neither is Home, distinct. */
export function canReorder(pages: readonly Page[], dragId: string, targetId: string, defaultLocale: string): boolean {
  if (dragId === targetId) return false;
  const byId = new Map(pages.map((p) => [p.id, p] as const));
  const drag = byId.get(dragId);
  const target = byId.get(targetId);
  if (!drag || !target) return false;
  if (isHome(drag) || isHome(target)) return false; // Home is pinned first (a link placeholder is reorderable)
  const present = new Set(pages.map((p) => p.id));
  return siblingKey(drag, present, defaultLocale) === siblingKey(target, present, defaultLocale);
}

/**
 * Moves `dragId` to sit before/after `targetId` within their shared sibling group and returns
 * ONLY the pages whose effective `order` changed, as new immutable copies (sequential 0..n
 * within the group). Returns `[]` for an invalid or no-op move. Home (empty slug) is pinned
 * and is never part of a group, so its order is left untouched.
 */
export function reorderWithinParent(
  pages: readonly Page[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after',
  defaultLocale: string,
): Page[] {
  if (!canReorder(pages, dragId, targetId, defaultLocale)) return [];
  const byId = new Map(pages.map((p) => [p.id, p] as const));
  const present = new Set(pages.map((p) => p.id));
  const key = siblingKey(byId.get(dragId)!, present, defaultLocale);

  // The group's current order (excluding Home, which never joins a group).
  const group = pages
    .filter((p) => p.path !== '' && siblingKey(p, present, defaultLocale) === key)
    .sort((a, b) => bySiblingOrder(a, b, defaultLocale));

  const ids = group.map((p) => p.id).filter((id) => id !== dragId);
  const targetIdx = ids.indexOf(targetId);
  if (targetIdx < 0) return [];
  ids.splice(place === 'before' ? targetIdx : targetIdx + 1, 0, dragId);

  // Reassign sequential `order` by rank; emit only pages whose effective order actually
  // changes (a page already sorting at its new rank needs no write).
  const updated: Page[] = [];
  ids.forEach((id, i) => {
    const p = byId.get(id)!;
    if (orderValue(p) !== i) updated.push({ ...p, order: i });
  });
  return updated;
}
