// Assembly of the SHOP CATALOG SNAPSHOT — the authoritative price list a processed
// payment is charged against.
//
// Called from inside the publish build, in the same pass that renders the HTML, so the snapshot can
// never describe a version of the site that is not the one being served — the same rationale as
// search-index.ts.
//
// It lives HERE, next to cart.ts, because the attribute vocabulary it reads is emitted by the
// `{{sw-add-to-cart}}` helper in template.ts and consumed by the cart runtime in cart.ts. A private
// copy of those names on the build side would drift, and the failure would be silent: a SKU that
// renders a buy button and cannot be priced.
//
// ★ WHY THIS EXISTS AT ALL. `{{sw-add-to-cart}}` puts `data-price` in the markup and cart.js totals
// it in localStorage. That is client-tamperable BY DESIGN and correct for the mini-shop's order
// inquiry — and unusable as a charge amount. So the browser sends only `{sku, qty}` and the server
// re-prices from this snapshot. The consequence is worth documenting loudly rather than hiding: a
// price change becomes chargeable only after a REPUBLISH.
//
// ★ WHY THE RENDERED HTML, NOT THE SOURCE. The cart markers are emitted by a Handlebars helper, so
// they do not appear in a page's `source` at all — scanning the source would find nothing. It is the
// same lesson `usesCart` already records for its own detection marker.
import { createHash } from 'node:crypto';
import { parseDocument } from 'htmlparser2';
import * as DomUtils from 'domutils';
import type { Element } from 'domhandler';
import { toMinorUnits, type MinorUnitsFailure } from '@sitewright/schema';
import { CART_ADD_MARKER } from './cart.js';

/** One priced, purchasable line as the published site offers it. */
export interface CatalogItem {
  sku: string;
  name: string;
  /** Integer minor units of the SETTLEMENT currency. The only price the server will ever charge. */
  priceMinor: number;
  image?: string;
  /**
   * The quantity the AUTHOR last declared via `stock=`, or undefined for an untracked SKU.
   *
   * ★ This is not the live quantity. It is the author's statement of intent, which the stock ledger
   * uses to decide whether a restock happened — see `reconcileStock`.
   */
  stock?: number;
}

/** A reason the catalog could not be built. Carries the page so an author can go and fix it. */
export interface CatalogProblem {
  sku: string;
  /** Route of a page the problem was seen on. */
  route: string;
  message: string;
}

/** Accumulates across pages. Build one, feed every page's HTML, then `finishCatalog`. */
export interface CatalogAccumulator {
  readonly currency: string;
  /** sku → item, plus the first route it was seen on (for a conflict message). */
  readonly items: Map<string, CatalogItem & { route: string }>;
  readonly problems: CatalogProblem[];
}

export function createCatalogAccumulator(currency: string): CatalogAccumulator {
  return { currency, items: new Map(), problems: [] };
}

/**
 * Bound on how many add-to-cart markers one page may contribute.
 *
 * A storefront page legitimately holds dozens; thousands is a generated-content accident, and this
 * runs inside the build for every page of every publish. The cap is reported as a problem rather
 * than silently truncating, because a silently short catalog prices some SKUs and refuses others.
 */
const MAX_MARKERS_PER_PAGE = 2000;

/** Renders a MinorUnitsFailure as something an author can act on. Never echoes a huge value back. */
function describePriceFailure(f: MinorUnitsFailure, raw: string): string {
  const shown = raw.length > 32 ? `${raw.slice(0, 32)}…` : raw;
  switch (f.reason) {
    case 'not-a-number':
      return `price "${shown}" is not a plain decimal number`;
    case 'negative':
      return `price "${shown}" is negative`;
    case 'too-large':
      return `price "${shown}" is too large`;
    case 'not-representable':
      // ★ The important one. Rounding here would charge an amount that appears nowhere in the
      // project, so the publish stops and says exactly what is wrong.
      return `price "${shown}" has ${f.decimals} decimal places but this currency allows ${f.allowed} — it cannot be charged exactly`;
  }
}

/** Reads a non-negative integer attribute, or undefined when absent/!integral. */
function readStock(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (!/^\d{1,9}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/**
 * Harvests every add-to-cart marker in one rendered surface and folds it into `acc`.
 *
 * `html` should be the page body PLUS the chrome slots — a product tile in a footer is a legitimate
 * place to buy something, and a body-only scan would price it on some pages and not others.
 */
export function harvestCatalogPage(acc: CatalogAccumulator, html: string, route: string): void {
  // Cheap pre-filter: parsing every page of a 1,000-page site to find nothing is pure cost, and the
  // overwhelming majority of pages have no cart marker at all.
  if (!html.includes(CART_ADD_MARKER)) return;
  const doc = parseDocument(html, { decodeEntities: true });
  const markers = DomUtils.find(
    (node) => node.type === 'tag' && Object.prototype.hasOwnProperty.call((node as Element).attribs, CART_ADD_MARKER),
    doc.children,
    true,
    MAX_MARKERS_PER_PAGE + 1,
  ) as Element[];
  if (markers.length > MAX_MARKERS_PER_PAGE) {
    acc.problems.push({ sku: '', route, message: `more than ${MAX_MARKERS_PER_PAGE} add-to-cart buttons on one page` });
    return;
  }
  for (const el of markers) {
    const sku = (el.attribs['data-sku'] ?? '').trim();
    // A marker with no sku cannot be priced or ordered. The helper will not emit one (it requires a
    // key), so this is a hand-authored button — report it rather than dropping it, because a button
    // that silently cannot be bought is worse than a loud publish failure.
    if (!sku) {
      acc.problems.push({ sku: '', route, message: 'an add-to-cart button has no data-sku' });
      continue;
    }
    if (sku.length > 200) {
      acc.problems.push({ sku: sku.slice(0, 32), route, message: 'data-sku is longer than 200 characters' });
      continue;
    }
    const rawPrice = (el.attribs['data-price'] ?? '').trim();
    const parsed = toMinorUnits(rawPrice, acc.currency);
    if (!parsed.ok) {
      acc.problems.push({ sku, route, message: describePriceFailure(parsed, rawPrice) });
      continue;
    }
    const name = (el.attribs['data-name'] ?? sku).slice(0, 300);
    const image = el.attribs['data-image'];
    const stock = readStock(el.attribs['data-stock']);
    const prior = acc.items.get(sku);
    if (prior) {
      // ★ THE CONFLICT THAT MUST BLOCK A PUBLISH. The same SKU at two prices means "which price is
      // authoritative" depends on the order pages happen to be rendered in. That is the one thing a
      // charge amount may never depend on, so it is an error naming both pages rather than a
      // last-write-wins.
      if (prior.priceMinor !== parsed.minor) {
        acc.problems.push({
          sku,
          route,
          message: `priced ${fmt(prior.priceMinor)} on ${prior.route} and ${fmt(parsed.minor)} here — one SKU cannot have two prices`,
        });
      }
      // A later marker may legitimately carry a stock number the first did not (one tile shows
      // availability, another does not). Take the first DECLARED value and keep it stable; a
      // disagreement is not worth failing a publish over, because stock is reconciled against the
      // ledger's own record of what the author last said.
      if (prior.stock === undefined && stock !== undefined) prior.stock = stock;
      continue;
    }
    acc.items.set(sku, { sku, name, priceMinor: parsed.minor, ...(image ? { image } : {}), ...(stock !== undefined ? { stock } : {}), route });
  }
}

/** Minor units as a readable figure for an error message. Not locale-aware: this is a diagnostic. */
function fmt(minor: number): string {
  return `${minor} minor units`;
}

/** The finished snapshot. `digest` identifies exactly this price list on a transaction row. */
export interface ShopCatalog {
  currency: string;
  items: Record<string, CatalogItem>;
  digest: string;
}

/**
 * Seals the accumulator.
 *
 * Returns the problems rather than throwing: the caller decides whether this publish must fail
 * (a site with a `checkout` channel) or merely warn (a mini-shop, where prices were never
 * authoritative and a malformed one costs a cart line rather than a wrong charge). Making that
 * judgement here would force the stricter answer on a shop that does not need it.
 */
export function finishCatalog(acc: CatalogAccumulator): { catalog: ShopCatalog; problems: CatalogProblem[] } {
  const items: Record<string, CatalogItem> = {};
  // Sorted, so the digest is a function of the catalog's CONTENT and not of page iteration order —
  // otherwise an unchanged site would produce a new digest on every publish.
  for (const sku of [...acc.items.keys()].sort()) {
    const it = acc.items.get(sku)!;
    items[sku] = {
      sku: it.sku,
      name: it.name,
      priceMinor: it.priceMinor,
      ...(it.image ? { image: it.image } : {}),
      ...(it.stock !== undefined ? { stock: it.stock } : {}),
    };
  }
  const digest = createHash('sha256').update(JSON.stringify({ c: acc.currency, i: items })).digest('hex').slice(0, 32);
  return { catalog: { currency: acc.currency, items, digest }, problems: acc.problems };
}

/** Formats problems into one publish-failure message that names every offender. */
export function describeCatalogProblems(problems: readonly CatalogProblem[]): string {
  const lines = problems.slice(0, 20).map((p) => `  • ${p.sku ? `${p.sku}: ` : ''}${p.message} (${p.route})`);
  const more = problems.length > 20 ? `\n  …and ${problems.length - 20} more` : '';
  return `The shop catalog could not be built:\n${lines.join('\n')}${more}`;
}

