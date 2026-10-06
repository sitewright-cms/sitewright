import {
  composeAmounts,
  fromMinorUnits,
  toMinorUnits,
  MAX_CHECKOUT_LINES,
  type CheckoutItem,
  type ShopPricing,
  type TransactionAmounts,
  type TransactionLine,
} from '@sitewright/schema';
import type { ShopCatalog } from '@sitewright/blocks';

/**
 * SERVER-SIDE RE-PRICING — the step that makes a cart chargeable.
 *
 * ★★ The browser sends `{sku, qty}` and NOTHING ELSE. No price, no currency, no total. Every figure
 * below comes from the catalog snapshot the publish build produced, so a tampered cart cannot change
 * what a buyer is charged — the worst it can do is order a different quantity of a real product at
 * the real price.
 */

export type PricingFailure =
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too-many-lines'; limit: number }
  | { ok: false; reason: 'unknown-sku'; sku: string }
  | { ok: false; reason: 'duplicate-sku'; sku: string }
  | { ok: false; reason: 'zero-total' };

export interface PricedOrder {
  ok: true;
  currency: string;
  lines: TransactionLine[];
  amounts: TransactionAmounts;
  catalogDigest: string;
  /** A short human summary for the provider's own description field. */
  orderName: string;
}

/**
 * Prices a requested cart against a snapshot.
 *
 * An unknown SKU is REFUSED rather than skipped. Skipping it would charge for a subset of what the
 * buyer thinks they are buying and send the merchant an order that silently lost a line — far worse
 * than a clear "that product is no longer available".
 */
export function priceOrder(
  items: readonly CheckoutItem[],
  catalog: ShopCatalog,
  pricing: ShopPricing | undefined,
): PricedOrder | PricingFailure {
  if (items.length === 0) return { ok: false, reason: 'empty' };
  if (items.length > MAX_CHECKOUT_LINES) return { ok: false, reason: 'too-many-lines', limit: MAX_CHECKOUT_LINES };

  const seen = new Set<string>();
  const lines: TransactionLine[] = [];
  for (const item of items) {
    // A duplicate SKU is refused rather than summed: a cart that sent the same line twice is a cart
    // whose own total disagrees with what it would be charged, and quietly merging them hides that.
    if (seen.has(item.sku)) return { ok: false, reason: 'duplicate-sku', sku: item.sku };
    seen.add(item.sku);
    const entry = Object.prototype.hasOwnProperty.call(catalog.items, item.sku) ? catalog.items[item.sku] : undefined;
    if (!entry) return { ok: false, reason: 'unknown-sku', sku: item.sku };
    lines.push({
      sku: entry.sku,
      // The NAME comes from the catalog too, not from the cart: an order confirmation must describe
      // what the site sells, not what a client said it sells.
      name: entry.name,
      unitMinor: entry.priceMinor,
      qty: item.qty,
      lineMinor: entry.priceMinor * item.qty,
    });
  }
  const amounts = composeAmounts(lines, pricing);
  // ★ A zero total is refused. Every provider rejects a zero-amount session anyway, and letting it
  // through would produce a transaction that can never resolve — a stuck order nobody can explain.
  if (amounts.totalMinor <= 0) return { ok: false, reason: 'zero-total' };
  return {
    ok: true,
    currency: catalog.currency,
    lines,
    amounts,
    catalogDigest: catalog.digest,
    orderName: summarize(lines),
  };
}

/** A one-line order description for a provider's `description` field. Bounded; never HTML. */
function summarize(lines: readonly TransactionLine[]): string {
  const parts = lines.map((l) => `${l.qty}x ${l.name}`);
  const joined = parts.join(', ');
  return joined.length <= 180 ? joined : `${joined.slice(0, 177)}...`;
}

/**
 * Renders each priced line for the review step.
 *
 * ★ Formatted HERE, not in the browser. The review step exists to show the SERVER's numbers, and a
 * client that re-formats them is a client that can disagree about them — which is the exact class of
 * defect the step was added to remove.
 */
export function describeLines(lines: readonly TransactionLine[], currency: string): Array<{ name: string; qty: number; amount: string }> {
  return lines.map((l) => ({ name: l.name, qty: l.qty, amount: fromMinorUnits(l.lineMinor, currency) }));
}

/** Renders the authoritative breakdown for the review step and the provider payload. */
export function describeAmounts(amounts: TransactionAmounts, currency: string): Record<string, string> {
  return {
    subtotal: fromMinorUnits(amounts.subtotalMinor, currency),
    shipping: fromMinorUnits(amounts.shippingMinor, currency),
    tax: fromMinorUnits(amounts.taxMinor, currency),
    total: fromMinorUnits(amounts.totalMinor, currency),
  };
}

/**
 * Cross-checks the amount a provider claims against the amount the platform computed.
 *
 * ★ A mismatch must NOT resolve the order. It means the gateway template, the currency or the event
 * mapping is wrong, and accepting the provider's figure would record a payment the shop did not ask
 * for — in either direction. Returned as a boolean so the caller can refuse and alert.
 *
 * A provider that echoes no amount is not a mismatch: most do not, and demanding one would make the
 * check a reason to reject every genuine event from those providers.
 */
export function amountMatches(
  expected: { totalMinor: number; currency: string },
  claimed: { amountMinor?: number; amountDecimal?: string; currency?: string },
): boolean {
  if (claimed.currency !== undefined && claimed.currency.toUpperCase() !== expected.currency.toUpperCase()) return false;
  if (claimed.amountMinor !== undefined) return claimed.amountMinor === expected.totalMinor;
  if (claimed.amountDecimal !== undefined) {
    // ★ Parsed to MINOR UNITS and compared as integers, not compared as strings: a provider that
    // sends "19.9" for 19.90, or "1999.00" where the currency has no decimals, is reporting the same
    // amount and must not be read as a mismatch. A string compare fails CLOSED (the order is left
    // unresolved rather than wrongly resolved), so this was not a hole — but it would have made every
    // genuine webhook from a provider that does not zero-pad look like an attack.
    const parsed = toMinorUnits(claimed.amountDecimal, expected.currency);
    // Unparseable is a real mismatch: the platform cannot agree with a figure it cannot read.
    return parsed.ok && parsed.minor === expected.totalMinor;
  }
  return true;
}
