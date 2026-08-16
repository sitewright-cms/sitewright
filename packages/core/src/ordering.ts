import { ORDER_MAX_SCHEMA } from '@sitewright/schema';

/**
 * Sibling ordering for pages and dataset entries.
 *
 * ★ Why this exists: reordering used to reassign a DENSE 0..n rank to the whole sibling group, so
 * moving one item rewrote every item after it — measured at ~700 writes for a single drag in an
 * 831-page group, which does not fit inside the content route's own rate limit. Placing an item at
 * the MIDPOINT of its two neighbours makes the ordinary move exactly one write; the group is only
 * re-spaced when a gap has genuinely run out of integers.
 */

/**
 * Upper bound of `page.order` / `entry.order`.
 *
 * ★ Was 100_000, which is the reason midpoint insertion needs this at all: 831 siblings sharing
 * 100_000 leaves ~120 units between neighbours, so the same position absorbs only ~6 insertions
 * (each midpoint halves the gap) before there is no integer left. At 2^31-1 the same group starts
 * ~2.5M apart and absorbs 20+. Raising a maximum is a RELAXATION — every stored value is still
 * valid, so no migration.
 */
export const ORDER_MAX = ORDER_MAX_SCHEMA;

/** The gap left between neighbours when a group is (re)spaced and it comfortably fits. */
export const ORDER_STEP = 65_536;

/**
 * An integer strictly between `before` and `after`, or `null` when there is no room.
 *
 * `undefined` means "no neighbour on that side": the item is going to the start or the end of the
 * group, so the value is stepped outside the last known one rather than interpolated.
 *
 * ★ Returning `null` rather than a best guess is the point. A colliding or out-of-range value would
 * reorder the group in a way the author did not ask for and cannot see; `null` tells the caller to
 * re-space the group instead, which is the one case where rewriting siblings is warranted.
 */
export function orderBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return ORDER_STEP;
  if (before === undefined) {
    // Going to the TOP: step below the current first item, or split the space beneath it when the
    // step does not fit (an item already sitting close to 0).
    const first = after as number;
    if (first <= 0) return null;
    return first > ORDER_STEP ? first - ORDER_STEP : Math.floor(first / 2) || null;
  }
  if (after === undefined) {
    // Going to the END: step above the current last item, or split the space above it near the top.
    const last = before;
    if (last >= ORDER_MAX) return null;
    return ORDER_MAX - last > ORDER_STEP ? last + ORDER_STEP : last + Math.floor((ORDER_MAX - last) / 2) || null;
  }
  if (after - before < 2) return null; // adjacent, equal, or inverted — no integer fits between them
  return before + Math.floor((after - before) / 2);
}

/**
 * `n` evenly spaced order values for a freshly (re)spaced group.
 *
 * Deliberately starts at one step rather than 0 and stops one step short of {@link ORDER_MAX}, so
 * there is always room to insert BEFORE the first item and AFTER the last one — the two moves an
 * author makes most often, and the two a 0-based dense layout makes impossible on the first try.
 */
export function spacedOrders(n: number): number[] {
  if (n <= 0) return [];
  // Compress the step for a group too large for the comfortable spacing (n+1 slots so both ends
  // keep their margin). At the 2^31 ceiling this only engages past ~32k siblings.
  const step = Math.min(ORDER_STEP, Math.floor(ORDER_MAX / (n + 1)));
  return Array.from({ length: n }, (_, i) => (i + 1) * step);
}

/** The minimum an item needs to take part in {@link reorderList}. */
export interface Orderable {
  id: string;
  order?: number;
}

/**
 * Move `sourceId` before/after `targetId` in an ordered list, returning ONLY the items whose `order`
 * changed — one item in the ordinary case, the whole list when the destination gap has run out.
 *
 * The list may be in any order; it is sorted by effective order (absent sorts last, ties by id) the
 * same way the renderers do, so the caller can hand over its raw array.
 *
 * ★ This is the shared half of page and dataset-entry reordering. Both used to reassign a dense 0..n
 * rank, and both therefore rewrote the tail of their group on every move.
 */
export function reorderList<T extends Orderable>(
  list: readonly T[],
  sourceId: string,
  targetId: string,
  place: 'before' | 'after',
): T[] {
  if (sourceId === targetId) return [];
  const sorted = [...list].sort(
    (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const byId = new Map(sorted.map((x) => [x.id, x] as const));
  if (!byId.has(sourceId) || !byId.has(targetId)) return [];

  const ids = sorted.map((x) => x.id).filter((id) => id !== sourceId);
  const targetIdx = ids.indexOf(targetId);
  if (targetIdx < 0) return [];
  const at = place === 'before' ? targetIdx : targetIdx + 1;
  ids.splice(at, 0, sourceId);

  const before = at > 0 ? byId.get(ids[at - 1]!)?.order : undefined;
  const after = at + 1 < ids.length ? byId.get(ids[at + 1]!)?.order : undefined;
  const mid = orderBetween(before, after);
  if (mid !== null) return [{ ...byId.get(sourceId)!, order: mid }];

  // No room (or a legacy dense-from-0 list, whose top has nothing below it) — re-space the whole list.
  const spaced = spacedOrders(ids.length);
  const changed: T[] = [];
  ids.forEach((id, i) => {
    const item = byId.get(id)!;
    if (item.order !== spaced[i]) changed.push({ ...item, order: spaced[i]! });
  });
  return changed;
}
